import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
import { createHash } from 'crypto';
import { writeCsvFile } from '../analysis/csvWriter.js';
import type { AnalysisRequest, CraftTaxonomyRow, SegmentationMode, ShotObservation, VideoProbe } from '../../shared/analysisTypes.js';

interface EvidenceRecord {
  id: string;
  kind: 'frame' | 'audio' | 'caption' | 'credit' | 'external-source' | 'metadata' | 'manual-review';
  range?: { startSeconds: number; endSeconds: number };
  sourceUrl?: string | null;
  evidenceLevel: 'OBSERVED' | 'SOURCE_CONFIRMED';
  summary: string;
  generator: string;
  modelVersion?: string | null;
  transmittedExternally: boolean;
}

interface AnalysisValidator {
  compile(schema: object): ((data: unknown) => boolean) & { errors?: unknown };
  errorsText(errors?: unknown, options?: { separator?: string }): string;
}
const require = createRequire(import.meta.url);
const Ajv2020 = (require('ajv/dist/2020.js') as { default: new (options: object) => AnalysisValidator }).default;
const addFormats = require('ajv-formats') as (ajv: AnalysisValidator) => void;
const analysisSchema = require('../../../schemas/analysis-run.v1.schema.json') as object;
const analysisValidator = new Ajv2020({ allErrors: true, strict: false });
addFormats(analysisValidator);
const validateAnalysisSchema = analysisValidator.compile(analysisSchema);

const evidenceId = (shotId: string, kind: string): string => `E-${shotId}-${kind}`;
const fileSha256 = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
};
const claim = (value: unknown, evidenceLevel: 'OBSERVED' | 'SOURCE_CONFIRMED' | 'INFERRED' | 'UNKNOWN', evidenceIds: string[] = [], reason: string | null = null, modelReportedConfidence: number | null = null) => ({
  value,
  evidenceLevel,
  confidence: evidenceLevel === 'UNKNOWN' ? null : evidenceLevel === 'OBSERVED' || evidenceLevel === 'SOURCE_CONFIRMED' ? 1 : modelReportedConfidence,
  evidenceIds,
  alternatives: [],
  reason,
});
const secondsRange = (startSeconds: number, endSeconds: number) => ({ startSeconds: Number(startSeconds.toFixed(3)), endSeconds: Number(endSeconds.toFixed(3)) });
export const assertAnalysisReferences = (value: unknown): void => {
  if (!value || typeof value !== 'object') throw new Error('Analysis report must be an object');
  const report = value as Record<string, unknown>;
  const rows = (key: string): Array<Record<string, unknown>> => {
    const entry = report[key];
    if (!Array.isArray(entry)) throw new Error(`Analysis report ${key} must be an array`);
    return entry as Array<Record<string, unknown>>;
  };
  const evidence = rows('evidence');
  const scenes = rows('scenes');
  const shots = rows('shots');
  const applications = rows('techniqueApplications');
  const tasks = rows('productionPlan');
  const recommendations = rows('toolRecommendations');
  const ids = (items: Array<Record<string, unknown>>, label: string): Set<string> => {
    const result = new Set<string>();
    for (const item of items) {
      if (typeof item.id !== 'string' || result.has(item.id)) throw new Error(`${label} has a missing or duplicate id`);
      result.add(item.id);
    }
    return result;
  };
  const evidenceIds = ids(evidence, 'Evidence');
  const sceneIds = ids(scenes, 'Scenes');
  const shotIds = ids(shots, 'Shots');
  const applicationIds = ids(applications, 'Technique applications');
  const taskIds = ids(tasks, 'Production tasks');
  const recommendationIds = ids(recommendations, 'Tool recommendations');
  const requireIds = (items: unknown, valid: Set<string>, owner: string): void => {
    if (!Array.isArray(items)) return;
    for (const id of items) if (typeof id !== 'string' || !valid.has(id)) throw new Error(`${owner} references unknown id ${String(id)}`);
  };
  const checkClaims = (claims: unknown, owner: string): void => {
    if (!claims || typeof claims !== 'object') return;
    for (const [key, rawClaim] of Object.entries(claims)) {
      if (rawClaim && typeof rawClaim === 'object') requireIds((rawClaim as Record<string, unknown>).evidenceIds, evidenceIds, `${owner}.${key}`);
    }
  };
  for (const scene of scenes) {
    requireIds(scene.shotIds, shotIds, `Scene ${String(scene.id)}`);
    checkClaims(scene.claims, `Scene ${String(scene.id)}`);
  }
  for (const shot of shots) {
    requireIds([shot.sceneId], sceneIds, `Shot ${String(shot.id)}`);
    requireIds(shot.techniqueApplicationIds, applicationIds, `Shot ${String(shot.id)}`);
    checkClaims(shot.claims, `Shot ${String(shot.id)}`);
  }
  for (const application of applications) {
    requireIds(application.shotIds, shotIds, `Technique application ${String(application.id)}`);
    checkClaims({ claim: application.claim }, `Technique application ${String(application.id)}`);
  }
  for (const task of tasks) {
    requireIds(task.dependsOn, taskIds, `Task ${String(task.id)}`);
    requireIds(task.evidenceIds, evidenceIds, `Task ${String(task.id)}`);
    requireIds(task.toolRecommendationIds, recommendationIds, `Task ${String(task.id)}`);
  }
  for (const recommendation of recommendations) {
    requireIds([recommendation.taskId], taskIds, `Tool recommendation ${String(recommendation.id)}`);
    requireIds(recommendation.relatedTaskIds, taskIds, `Tool recommendation ${String(recommendation.id)}`);
    requireIds(recommendation.evidenceIds, evidenceIds, `Tool recommendation ${String(recommendation.id)}`);
    checkClaims({ claim: recommendation.claim }, `Tool recommendation ${String(recommendation.id)}`);
  }
};

const safeSourceUrl = (raw: string | undefined): string | null => {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.hash = '';
    if (/(^|\.)youtube\.com$/i.test(url.hostname)) {
      const id = url.searchParams.get('v');
      url.search = '';
      if (id) url.searchParams.set('v', id);
    } else if (/(^|\.)youtu\.be$/i.test(url.hostname)) {
      url.search = '';
    } else {
      url.search = '';
    }
    return url.toString();
  } catch {
    return null;
  }
};
const TOOL_CATALOG_CHECKED_AT = '2026-10-18T00:00:00.000Z';
const TOOL_CATALOG_VERSION = '2026-10-18.1';
const labelKeys = [
  'shotSize', 'cameraMotion', 'cameraAxis', 'lightingType', 'palette', 'composition',
  'subjectKind', 'narrativeFunctionGuess', 'transitionGuess', 'actionPhaseSummary',
] as const;
const csvColumnsFor = (rows: Array<Record<string, unknown>>): string[] => Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
const csvCell = (value: unknown): string | number => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return value;
  return JSON.stringify(value);
};

export interface StructuredReportResult {
  analysisJsonPath: string;
  manifestPath: string;
  toolRecommendationsPath: string;
  artifactPaths: string[];
}

export const writeStructuredAnalysisReport = async (input: {
  request: AnalysisRequest;
  probe: VideoProbe;
  observations: ShotObservation[];
  taxonomyRows: CraftTaxonomyRow[];
  segmentationMode: SegmentationMode;
  startedAt: string;
}): Promise<StructuredReportResult> => {
  const { request, probe, observations, taxonomyRows, segmentationMode, startedAt } = input;
  fs.mkdirSync(request.outputDir, { recursive: true });
  const modelName = request.vision.provider ? `${request.vision.provider.providerID ?? 'opencode'}/${request.vision.provider.model}` : null;
  const evidence: EvidenceRecord[] = [];
  const taxonomyById = new Map(taxonomyRows.map((row) => [row.techniqueId, row]));
  const shots = observations.map((observation) => {
    const signalEvidenceId = evidenceId(observation.shotId, 'SIGNALS');
    evidence.push({
      id: signalEvidenceId,
      kind: 'metadata',
      range: secondsRange(observation.startS, observation.endS),
      evidenceLevel: 'OBSERVED',
      summary: `ffmpeg-decoded luma and scene-score signals: motion_proxy=${observation.signals.motion}, scene_score=${observation.signals.cutScoreMax}, luma_mean=${observation.signals.lumaMean}, luma_stddev=${observation.signals.lumaStddev}, audio_rms_mean=${observation.signals.audioRmsMean ?? 'unknown'}, silence_ratio=${observation.signals.silenceRatio ?? 'unknown'}.`,
      generator: 'Flucto ffmpeg signal pipeline',
      modelVersion: null,
      transmittedExternally: false,
    });
    const frameEvidenceId = evidenceId(observation.shotId, 'VISION');
    const hasVisionLabels = Object.keys(observation.labels).some((key) => key !== 'confidence');
    if (hasVisionLabels) {
      evidence.push({
        id: frameEvidenceId,
        kind: 'frame',
        range: secondsRange(observation.startS, observation.endS),
        evidenceLevel: 'OBSERVED',
        summary: 'Representative frame samples were decoded in memory from this shot; pixels were not persisted.',
        generator: 'Flucto frame sampler',
        modelVersion: modelName,
        transmittedExternally: true,
      });
    }
    const labelClaims: Record<string, ReturnType<typeof claim>> = {};
    for (const key of labelKeys) {
      const value = observation.labels[key];
      labelClaims[key] = value
        ? claim(value, 'INFERRED', [frameEvidenceId], 'Vision model interpretation; confidence is the model-reported score, uncalibrated and not a verified production fact.', typeof observation.labels.confidence === 'number' && Number.isFinite(observation.labels.confidence) && observation.labels.confidence >= 0 && observation.labels.confidence <= 1 ? observation.labels.confidence : null)
        : claim(null, 'UNKNOWN', [], 'No sufficiently confident value was returned.');
    }
    const signalClaims = {
      durationSeconds: claim(observation.durationS, 'OBSERVED', [signalEvidenceId]),
      lumaMean: claim(observation.signals.lumaMean, 'OBSERVED', [signalEvidenceId]),
      lumaStddev: claim(observation.signals.lumaStddev, 'OBSERVED', [signalEvidenceId]),
      brightnessTrend: claim(observation.signals.brightnessTrend, 'OBSERVED', [signalEvidenceId]),
      audioRmsMean: observation.signals.audioRmsMean === null ? claim(null, 'UNKNOWN', [signalEvidenceId], 'No usable audio RMS measurements.') : claim(observation.signals.audioRmsMean, 'OBSERVED', [signalEvidenceId]),
      silenceRatio: observation.signals.silenceRatio === null ? claim(null, 'UNKNOWN', [signalEvidenceId], 'No audio stream was detected.') : claim(observation.signals.silenceRatio, 'OBSERVED', [signalEvidenceId]),
      motion: claim(null, 'UNKNOWN', [signalEvidenceId], 'Current proxy is luma variation, not measured camera or subject motion.'),
      shotBoundary: claim(observation.cutType, observation.cutType === 'UNKNOWN' ? 'UNKNOWN' : 'INFERRED', [signalEvidenceId], 'Scene detector candidate; boundary has not been independently frame-verified.'),
      ...labelClaims,
    };
    return {
      id: observation.shotId,
      sceneId: observation.sceneId,
      range: secondsRange(observation.startS, observation.endS),
      boundaryType: observation.cutType === 'HARD-CUT' ? 'hard-cut' : 'unknown',
      boundaryConfidence: null,
      claims: signalClaims,
      techniqueApplicationIds: observation.matchedTechniqueIds.map((id) => `TA-${observation.shotId}-${id}`),
    };
  });

  const sceneGroups = new Map<string, typeof observations>();
  for (const shot of observations) {
    const group = sceneGroups.get(shot.sceneId) ?? [];
    group.push(shot);
    sceneGroups.set(shot.sceneId, group);
  }
  const scenes = Array.from(sceneGroups.entries()).map(([id, group]) => ({
    id,
    range: secondsRange(Math.min(...group.map((shot) => shot.startS)), Math.max(...group.map((shot) => shot.endS))),
    shotIds: group.map((shot) => shot.shotId),
    claims: {
      grouping: claim({ method: 'adjacent shots with at least two matching subject/palette/lighting labels' }, 'INFERRED', group.flatMap((shot) => [evidenceId(shot.shotId, 'SIGNALS'), ...(Object.keys(shot.labels).some((key) => key !== 'confidence') ? [evidenceId(shot.shotId, 'VISION')] : [])]), 'Heuristic scene grouping from model labels; visually continuous scenes may be split and unrelated shots may be merged.'),
      setting: claim(null, 'UNKNOWN', [], 'Location and time recognition are not implemented.'),
      sceneFunction: claim(null, 'UNKNOWN', [], 'Scene-level narrative analysis is not implemented.'),
    },
  }));

  const techniqueApplications = observations.flatMap((observation) => observation.matchedTechniqueIds.map((techniqueId) => {
    const technique = taxonomyById.get(techniqueId);
    const evidenceIds = [evidenceId(observation.shotId, 'SIGNALS')];
    if (Object.keys(observation.labels).some((key) => key !== 'confidence')) evidenceIds.push(evidenceId(observation.shotId, 'VISION'));
    return {
      id: `TA-${observation.shotId}-${techniqueId}`,
      techniqueId,
      shotIds: [observation.shotId],
      claim: claim({ matchedEvidence: observation.matchedEvidence, title: technique?.titleKo ?? techniqueId }, 'INFERRED', evidenceIds, 'Taxonomy match is a candidate interpretation; confirm manually before treating it as an intentional technique.'),
      reproductionNotes: technique?.howToApply || technique?.definition || 'No reviewed reproduction instruction is available for this catalog entry.',
      failureModes: technique?.pitfalls ? [technique.pitfalls] : [],
    };
  }));

  const productionPlan = observations.flatMap((observation) => {
    const evidenceIds = [evidenceId(observation.shotId, 'SIGNALS')];
    const inferred = labelKeys.map((key) => observation.labels[key] ? `${key}: ${observation.labels[key]}` : null).filter((value): value is string => value !== null);
    if (inferred.length > 0) evidenceIds.push(evidenceId(observation.shotId, 'VISION'));
    const matchedTechniques = observation.matchedTechniqueIds.map((id) => taxonomyById.get(id)).filter((row): row is CraftTaxonomyRow => Boolean(row));
    const techniqueInstructions = matchedTechniques.map((row) => row.howToApply || row.definition).filter(Boolean);
    const shotDescription = inferred.length ? inferred.join('; ') : 'Visual treatment is unknown; inspect the reference manually before production.';
    const base = {
      id: `TASK-${observation.shotId}-PREP`,
      stage: 'pre-production',
      dependsOn: [],
      instruction: `Create a shot card for ${observation.shotId} (${observation.startTimecode}–${observation.endTimecode}). Record confirmed visual requirements and flag each model interpretation for human review. ${techniqueInstructions.join(' ')}`.trim(),
      input: [`Reference timecode ${observation.startTimecode}–${observation.endTimecode}`, shotDescription],
      output: `Approved shot card for ${observation.shotId}`,
      acceptanceCriteria: ['Shot duration and in/out points are documented.', 'Inferred visual properties are reviewed or explicitly left unknown.', 'No camera, lens, lighting fixture, software, or model is claimed without source evidence.'],
      promptDraft: `Create an original shot using these general production attributes, not a creator-specific style imitation: ${shotDescription}. Target duration ${observation.durationS.toFixed(2)} seconds.`,
      evidenceIds,
      limitations: ['Video-generation model suitability has not been assessed against a verified capability catalog.'],
      toolRecommendationIds: [] as string[],
    };
    const production = {
      ...base,
      id: `TASK-${observation.shotId}-PRODUCE`,
      stage: 'production',
      dependsOn: [base.id],
      instruction: `Shoot or generate ${observation.shotId} against the approved shot card. Preserve only the reviewed attributes: ${shotDescription}. Treat non-visible camera/lighting equipment as unknown.`,
      input: [`Approved shot card ${base.id}`, ...techniqueInstructions],
      output: `Candidate shot for ${observation.shotId}`,
      acceptanceCriteria: ['Compare framing, subject placement, duration, and visible lighting against the reference.', 'Reject unsupported assumptions about original production equipment.', 'Keep generated or captured footage rights-cleared.'],
      promptDraft: null,
    };
    const edit = {
      ...base,
      id: `TASK-${observation.shotId}-EDIT`,
      stage: 'post-production',
      dependsOn: [production.id],
      instruction: `Place the approved ${observation.shotId} at ${observation.startTimecode}–${observation.endTimecode} and compare its pacing with the reference. Transition type remains unknown unless verified.`,
      input: [production.output, `Reference duration ${observation.durationS.toFixed(3)} seconds`],
      output: `Edited shot segment ${observation.shotId}`,
      acceptanceCriteria: ['In/out and duration are reviewed against the reference.', 'Transition and audio treatment remain explicitly unknown until inspected.'],
      promptDraft: null,
    };
    return [base, production, edit];
  });

  const toolRecommendations: Array<Record<string, unknown>> = [];
  let resolveRecommendation: Record<string, unknown> | null = null;
  const catalogEvidenceIds = new Set<string>();
  const addToolEvidence = (id: string, sourceUrl: string, summary: string): void => {
    if (catalogEvidenceIds.has(id)) return;
    catalogEvidenceIds.add(id);
    evidence.push({ id, kind: 'external-source', sourceUrl, evidenceLevel: 'SOURCE_CONFIRMED', summary, generator: 'Flucto curated official capability reference', modelVersion: null, transmittedExternally: false });
  };
  for (const task of productionPlan) {
    if (task.stage === 'post-production') {
      const id = 'TOOL-DAVINCI-RESOLVE-EDITING';
      const sourceEvidenceId = 'E-TOOL-DAVINCI-RESOLVE';
      const sourceUrl = 'https://www.blackmagicdesign.com/products/davinciresolve';
      addToolEvidence(sourceEvidenceId, sourceUrl, 'Blackmagic Design official DaVinci Resolve product page: editing, color, visual effects and audio post-production capabilities.');
      task.toolRecommendationIds.push(id);
      if (resolveRecommendation) {
        (resolveRecommendation.relatedTaskIds as string[]).push(task.id);
      } else {
        resolveRecommendation = {
          id, taskId: task.id, relatedTaskIds: [], category: 'editing', name: 'DaVinci Resolve', version: null,
          catalogVersion: TOOL_CATALOG_VERSION, pricingStatus: 'unknown', licenseStatus: 'unknown',
          capability: 'Recommended for assembling and timing the full shot sequence; official product information also lists color, visual-effects, and audio post-production tools.',
          claim: claim({ rationale: 'A dedicated non-linear editor can execute the sequence and duration-matching tasks.' }, 'INFERRED', [sourceEvidenceId], 'This is a workflow recommendation, not evidence that the reference was made in DaVinci Resolve.'),
          evidenceIds: [sourceEvidenceId], sourceUrl, checkedAt: TOOL_CATALOG_CHECKED_AT, alternatives: ['Use another non-linear editor capable of frame-accurate timeline editing.'],
        };
        toolRecommendations.push(resolveRecommendation);
      }
    }
    if (task.stage === 'production') {
      const observation = observations.find((shot) => task.id === `TASK-${shot.shotId}-PRODUCE`);
      const described = `${observation?.labels.subjectKind ?? ''} ${observation?.labels.actionPhaseSummary ?? ''}`;
      if (/\b(3d|cgi|computer[- ]generated|animated|animation)\b/i.test(described)) {
        const id = `TOOL-${task.id}-BLENDER`;
        const sourceEvidenceId = 'E-TOOL-BLENDER';
        const sourceUrl = 'https://www.blender.org/features/';
        addToolEvidence(sourceEvidenceId, sourceUrl, 'Blender official features page: 3D modeling, animation, rendering, compositing and video editing capabilities.');
        task.toolRecommendationIds.push(id);
        toolRecommendations.push({
          id, taskId: task.id, category: 'compositing', name: 'Blender', version: null,
          catalogVersion: TOOL_CATALOG_VERSION, pricingStatus: 'unknown', licenseStatus: 'unknown',
          capability: 'Consider for original 3D/CGI asset or animation work when the shot is explicitly labeled as animated; not a substitute for evidence of the source production tool.',
          claim: claim({ rationale: 'The shot interpretation contains an animation/CGI cue.' }, 'INFERRED', [sourceEvidenceId, evidenceId(observation?.shotId ?? '', 'VISION')], 'The cue itself is a model estimate and requires review.'),
          evidenceIds: [sourceEvidenceId, evidenceId(observation?.shotId ?? '', 'VISION')], sourceUrl, checkedAt: TOOL_CATALOG_CHECKED_AT, alternatives: ['A practical camera shoot if the scene can be captured physically.'],
        });
      }
    }
  }

  const sourceSha256 = await fileSha256(request.videoPath);
  const analysis = {
    schemaVersion: '1.0.0',
    runId: `RUN-${Date.now()}`,
    status: observations.some((observation) => observation.analysisStatus !== 'labeled') || segmentationMode.mode !== 'full' ? 'partial' : 'completed',
    source: {
      kind: request.sourceUrl ? 'url' : 'local-file',
      displayName: path.basename(request.videoPath),
      canonicalUrl: safeSourceUrl(request.sourceUrl),
      sha256: sourceSha256,
      durationSeconds: probe.durationS,
      width: probe.width || null,
      height: probe.height || null,
      frameRate: probe.fps || null,
    },
    coverage: {
      mode: segmentationMode.mode,
      analyzedRanges: observations.map((shot) => secondsRange(shot.startS, shot.endS)),
      omittedRanges: [],
      reason: segmentationMode.reason,
    },
    evidence,
    scenes,
    shots,
    techniqueApplications,
    productionPlan,
    toolRecommendations,
    limitations: [
      'No verified video-generation model capability catalog is configured; no video model is claimed to recreate the reference.',
      'Scene grouping is a weak adjacent-label heuristic; verify every scene boundary manually.',
      'Scene detection candidates and vision labels have not been independently validated.',
      'Camera/subject motion separation and semantic audio/music analysis are not available in this run; RMS and silence are coarse audio signals only.',
      'The production plan is a first-pass shot workflow. Expert review is required before claiming faithful reproduction.',
    ],
    provenance: {
      startedAt,
      completedAt: new Date().toISOString(),
      generators: [
        { name: 'Flucto ffmpeg analysis', version: '1', model: null },
        ...(modelName ? [{ name: 'OpenCode vision', version: 'runtime-managed', model: modelName }] : []),
      ],
    },
  };

  assertAnalysisReferences(analysis);
  if (!validateAnalysisSchema(analysis)) {
    const errors = analysisValidator.errorsText(validateAnalysisSchema.errors, { separator: '; ' });
    throw new Error(`Generated analysis does not match schema v1.0.0: ${errors}`);
  }
  const output = request.outputDir;
  const analysisJsonPath = path.join(output, 'analysis.json');
  fs.writeFileSync(analysisJsonPath, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
  const artifactPaths = [analysisJsonPath, path.join(output, 'shotlog.csv'), path.join(output, 'techniques.csv')];
  const emitCsv = (name: string, rows: Array<Record<string, unknown>>, emptyColumns: string[]) => {
    const target = path.join(output, name);
    const columns = rows.length ? csvColumnsFor(rows) : emptyColumns;
    writeCsvFile(target, columns, rows.map((row) => columns.map((column) => csvCell(row[column]))));
    artifactPaths.push(target);
  };
  emitCsv('shots.csv', shots.map((shot) => ({ shot_id: shot.id, scene_id: shot.sceneId, start_s: shot.range.startSeconds, end_s: shot.range.endSeconds, duration_s: shot.claims.durationSeconds.value as number, boundary_type: shot.boundaryType, boundary_confidence: shot.boundaryConfidence, claims: shot.claims, technique_application_ids: shot.techniqueApplicationIds })), ['shot_id', 'scene_id', 'start_s', 'end_s', 'duration_s', 'boundary_type', 'boundary_confidence', 'claims', 'technique_application_ids']);
  emitCsv('scenes.csv', scenes.map((scene) => ({ scene_id: scene.id, start_s: scene.range.startSeconds, end_s: scene.range.endSeconds, shot_ids: scene.shotIds, claims: scene.claims })), ['scene_id', 'start_s', 'end_s', 'shot_ids', 'claims']);
  emitCsv('evidence.csv', evidence as unknown as Array<Record<string, unknown>>, ['id', 'kind', 'range', 'evidenceLevel', 'summary', 'generator', 'modelVersion', 'transmittedExternally']);
  emitCsv('technique_applications.csv', techniqueApplications.map((row) => ({ ...row, claim: row.claim, reproductionNotes: row.reproductionNotes, failureModes: row.failureModes })), ['id', 'techniqueId', 'shotIds', 'claim', 'reproductionNotes', 'failureModes']);
  emitCsv('production_plan.csv', productionPlan as unknown as Array<Record<string, unknown>>, ['id', 'stage', 'dependsOn', 'instruction', 'input', 'output', 'acceptanceCriteria', 'promptDraft', 'evidenceIds', 'limitations', 'toolRecommendationIds']);
  emitCsv('tool_recommendations.csv', toolRecommendations, ['id', 'taskId', 'relatedTaskIds', 'category', 'name', 'version', 'catalogVersion', 'pricingStatus', 'licenseStatus', 'capability', 'claim', 'evidenceIds', 'sourceUrl', 'checkedAt', 'alternatives']);
  const toolRecommendationsPath = path.join(output, 'tool_recommendations.csv');
  const manifestPath = path.join(output, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({ schemaVersion: '1.0.0', runId: analysis.runId, startedAt, completedAt: analysis.provenance.completedAt, sourceSha256, segmentationMode, shotCount: shots.length, sceneCount: scenes.length, evidenceCount: evidence.length, artifactFiles: [...artifactPaths.map((file) => path.basename(file)), 'manifest.json'], model: modelName, externalFrameTransmission: Boolean(request.vision.enabled && request.vision.provider) }, null, 2)}\n`, 'utf8');
  artifactPaths.push(manifestPath);
  return { analysisJsonPath, manifestPath, toolRecommendationsPath, artifactPaths };
};

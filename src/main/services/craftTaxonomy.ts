/**
 * Craft taxonomy build + load (design A1, A3).
 *
 * Sources are Declan-owned md files: contents-production-skills references
 * (rule-parsed here) and optional pre-extracted book entries JSON produced by
 * an offline agent pass (`--book-extracts`). Book originals are never read or
 * written by this code; the catalog stores paraphrases plus source locators.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  parseCsvWithColumns,
  writeCsvFile,
} from '../analysis/csvWriter.js';
import type {
  CraftBuildManifest,
  CraftDomain,
  CraftTaxonomyRow,
  LifecycleStage,
  RawTechniqueEntry,
  TaxonomyEvidenceLevel,
} from '../../shared/analysisTypes.js';

const CRAFT_DOMAINS = new Set<string>([
  'pre-production',
  'composition',
  'camera',
  'lighting',
  'performance',
  'editing',
  'sound',
  'narrative',
  'finishing-delivery',
]);

const LIFECYCLE_STAGES = new Set<string>([
  '01-development',
  '02-screenwriting',
  '03-pre-production',
  '04-production',
  '05-post-production',
  '06-distribution',
]);

const EVIDENCE_LEVELS = new Set<string>(['verified', 'reviewed', 'unverified']);

const TAXONOMY_COLUMNS = [
  'technique_id',
  'craft_domain',
  'lifecycle_stage',
  'title_ko',
  'title_en',
  'definition',
  'when_to_use',
  'how_to_apply',
  'pitfalls',
  'anchor_terms_ko',
  'anchor_terms_en',
  'signal_hints',
  'source_book',
  'source_locator',
  'evidence_level',
  'taxonomy_version',
] as const;

export const TAXONOMY_FILE = 'taxonomy.csv';
export const MANIFEST_FILE = 'build-manifest.json';

export class CraftTaxonomyMissingError extends Error {
  constructor(craftDir: string) {
    super(`No craft taxonomy under ${craftDir}. Run \`flucto craft build --skills <dir> -o ${craftDir}\` first.`);
    this.name = 'CraftTaxonomyMissingError';
  }
}

interface RefSource {
  file: string;
  domain: CraftDomain;
  stage: LifecycleStage;
}

const SKILL_REF_SOURCES: RefSource[] = [
  { file: '05-visual.md', domain: 'composition', stage: '04-production' },
  { file: '06-shots.md', domain: 'camera', stage: '04-production' },
  { file: '07-lighting.md', domain: 'lighting', stage: '04-production' },
  { file: '09-edit.md', domain: 'editing', stage: '05-post-production' },
  { file: '15-delivery.md', domain: 'finishing-delivery', stage: '06-distribution' },
  { file: '23-finishing-platform.md', domain: 'finishing-delivery', stage: '05-post-production' },
  { file: '25-reference-video-analysis.md', domain: 'narrative', stage: '03-pre-production' },
  { file: '28-film-production-lifecycle.md', domain: 'pre-production', stage: '01-development' },
];

const sha256File = (filePath: string): string => {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
};

const hashSeed = (value: string): string => {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
};

const cleanHeading = (line: string): string => {
  return line
    .replace(/^#+\s*/, '')
    .replace(/[*_`]/g, '')
    .trim();
};

const splitTerms = (value: string): string[] => {
  return Array.from(new Set(
    value
      .split(/[,;·/]|\s{2,}/)
      .map((term) => term.replace(/[*_`#>]/g, '').trim())
      .filter((term) => term.length >= 2 && term.length <= 40),
  )).slice(0, 8);
};

const firstParagraphSnippet = (lines: string[], startLine: number, maxLength = 220): string => {
  const buffer: string[] = [];
  let length = 0;
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (buffer.length > 0) break;
      continue;
    }
    if (line.startsWith('#')) break;
    buffer.push(line);
    length += line.length + 1;
    if (length >= maxLength) break;
  }
  return buffer.join(' ').slice(0, maxLength);
};

/** Skill references are parsed deterministically from their headings. */
export const parseSkillReference = (filePath: string, source: RefSource): RawTechniqueEntry[] => {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const entries: RawTechniqueEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^(#{2,4})\s+(.+)$/.exec(lines[i]);
    if (!heading) continue;
    const level = heading[1].length;
    const title = cleanHeading(heading[2]);
    if (title.length < 2 || title.length > 120) continue;
    const key = `${source.file}:${level}:${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      craftDomain: source.domain,
      lifecycleStage: source.stage,
      titleKo: title,
      titleEn: title,
      definition: firstParagraphSnippet(lines, i + 1),
      whenToUse: '',
      howToApply: '',
      pitfalls: '',
      anchorTermsKo: splitTerms(title),
      anchorTermsEn: splitTerms(title).filter((term) => !/[가-힣]/.test(term)),
      signalHints: [],
      sourceBook: path.basename(filePath),
      sourceLocator: `heading line ${i + 1} (level ${level})`,
      evidenceLevel: 'reviewed',
    });
  }
  return entries;
};

export class BookExtractValidationError extends Error {
  constructor(
    message: string,
    readonly entryIndex: number,
  ) {
    super(message);
    this.name = 'BookExtractValidationError';
  }
}

/**
 * Validate agent-extracted book entries. Oversized verbatim-looking
 * definitions (> 400 chars) are rejected to honor the big-copy guard; the
 * extraction pass is responsible for paraphrasing.
 */
export const validateBookExtracts = (raw: unknown): { entries: RawTechniqueEntry[]; rejected: number } => {
  if (!Array.isArray(raw)) {
    throw new BookExtractValidationError('Book extracts JSON must be an array of technique entries.', 0);
  }
  const entries: RawTechniqueEntry[] = [];
  let rejected = 0;
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      rejected += 1;
      return;
    }
    const candidate = item as RawTechniqueEntry;
    const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
    if (!hasText(candidate.titleKo) && !hasText(candidate.titleEn)) {
      throw new BookExtractValidationError(`Book extract #${index}: title_ko or title_en required.`, index);
    }
    if (!hasText(candidate.definition)) {
      throw new BookExtractValidationError(`Book extract #${index}: definition required.`, index);
    }
    if (candidate.definition.length > 400) {
      rejected += 1;
      return;
    }
    if (!CRAFT_DOMAINS.has(candidate.craftDomain)) {
      throw new BookExtractValidationError(`Book extract #${index}: unknown craft_domain "${candidate.craftDomain}".`, index);
    }
    if (!LIFECYCLE_STAGES.has(candidate.lifecycleStage)) {
      throw new BookExtractValidationError(`Book extract #${index}: unknown lifecycle_stage "${candidate.lifecycleStage}".`, index);
    }
    const titleKo = hasText(candidate.titleKo) ? candidate.titleKo.trim() : (candidate.titleEn ?? '').trim();
    const titleEn = hasText(candidate.titleEn) ? candidate.titleEn.trim() : titleKo;
    entries.push({
      craftDomain: candidate.craftDomain,
      lifecycleStage: candidate.lifecycleStage,
      titleKo,
      titleEn,
      definition: candidate.definition.trim().slice(0, 400),
      whenToUse: (candidate.whenToUse ?? '').slice(0, 300),
      howToApply: (candidate.howToApply ?? '').slice(0, 300),
      pitfalls: (candidate.pitfalls ?? '').slice(0, 300),
      anchorTermsKo: (candidate.anchorTermsKo ?? []).slice(0, 10),
      anchorTermsEn: (candidate.anchorTermsEn ?? []).slice(0, 10),
      signalHints: (candidate.signalHints ?? []).slice(0, 4),
      sourceBook: candidate.sourceBook ?? 'book-extracts',
      sourceLocator: (candidate.sourceLocator ?? '').slice(0, 160),
      evidenceLevel: EVIDENCE_LEVELS.has(candidate.evidenceLevel ?? '') ? candidate.evidenceLevel as TaxonomyEvidenceLevel : 'unverified',
    });
  });
  return { entries, rejected };
};

const mergeKey = (entry: RawTechniqueEntry): string => {
  const title = (entry.titleEn || entry.titleKo).toLowerCase();
  return `${entry.craftDomain}|${title}`;
};

/** Dedupe by (domain, title); merge anchor lists; first entry wins scalars. */
export const mergeTechniqueEntries = (all: RawTechniqueEntry[]): RawTechniqueEntry[] => {
  const byKey = new Map<string, RawTechniqueEntry>();
  for (const entry of all) {
    const key = mergeKey(entry);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...entry });
      continue;
    }
    existing.anchorTermsKo = Array.from(new Set([...existing.anchorTermsKo ?? [], ...entry.anchorTermsKo ?? []]));
    existing.anchorTermsEn = Array.from(new Set([...existing.anchorTermsEn ?? [], ...entry.anchorTermsEn ?? []]));
    existing.signalHints = Array.from(new Set([...existing.signalHints ?? [], ...entry.signalHints ?? []]));
  }
  return Array.from(byKey.values());
};

const shorten = (value: string, max: number): string => value.slice(0, max);

export interface BuildCraftTaxonomyInput {
  outputDir: string;
  skillsRoot: string | null;
  bookExtractsPath: string | null;
}

export interface BuildCraftTaxonomyResult {
  taxonomyPath: string;
  manifestPath: string;
  techniqueCount: number;
  unverifiedCount: number;
  rejectedBookEntries: number;
  manifest: CraftBuildManifest;
}

const taxonomyVersionFor = (entryCount: number, sourceRoots: string[]): string => {
  const seed = sourceRoots.join('|') || 'seed';
  return `1.0.${entryCount}+${hashSeed(seed)}`;
};

export const buildCraftTaxonomy = (input: BuildCraftTaxonomyInput): BuildCraftTaxonomyResult => {
  const rawEntries: RawTechniqueEntry[] = [];
  const manifestSources: CraftBuildManifest['sources'] = [];
  let rejectedBookEntries = 0;

  if (input.skillsRoot) {
    const refsDir = path.join(path.resolve(input.skillsRoot), 'video-production-assets', 'references');
    const files: string[] = [];
    const sha256: Record<string, string> = {};
    for (const source of SKILL_REF_SOURCES) {
      const filePath = path.join(refsDir, source.file);
      if (!fs.existsSync(filePath)) continue;
      rawEntries.push(...parseSkillReference(filePath, source));
      files.push(source.file);
      sha256[source.file] = sha256File(filePath);
    }
    if (files.length === 0) {
      throw new Error(`No known references found under ${refsDir}`);
    }
    manifestSources.push({ kind: 'skills-references', root: refsDir, files, sha256 });
  }

  if (input.bookExtractsPath) {
    const extractsPath = path.resolve(input.bookExtractsPath);
    const parsed: unknown = JSON.parse(fs.readFileSync(extractsPath, 'utf8'));
    const { entries, rejected } = validateBookExtracts(parsed);
    rawEntries.push(...entries);
    rejectedBookEntries = rejected;
    manifestSources.push({
      kind: 'book-extracts',
      root: extractsPath,
      files: [path.basename(extractsPath)],
      sha256: { [path.basename(extractsPath)]: sha256File(extractsPath) },
    });
  }

  if (rawEntries.length === 0) {
    throw new Error('No craft technique entries were produced; pass --skills and/or --book-extracts.');
  }

  const merged = mergeTechniqueEntries(rawEntries);
  const taxonomyVersion = taxonomyVersionFor(merged.length, manifestSources.map((source) => source.root));
  const rows: CraftTaxonomyRow[] = merged.map((entry) => ({
    techniqueId: `CTX-${entry.craftDomain.slice(0, 3).toUpperCase()}-${hashSeed(`${entry.craftDomain}|${entry.titleEn || entry.titleKo}`)}`,
    craftDomain: entry.craftDomain as CraftDomain,
    lifecycleStage: entry.lifecycleStage as LifecycleStage,
    titleKo: shorten(entry.titleKo, 160),
    titleEn: shorten(entry.titleEn, 160),
    definition: shorten(entry.definition, 400),
    whenToUse: shorten(entry.whenToUse ?? '', 300),
    howToApply: shorten(entry.howToApply ?? '', 300),
    pitfalls: shorten(entry.pitfalls ?? '', 300),
    anchorTermsKo: entry.anchorTermsKo ?? [],
    anchorTermsEn: entry.anchorTermsEn ?? [],
    signalHints: entry.signalHints ?? [],
    sourceBook: entry.sourceBook ?? '',
    sourceLocator: entry.sourceLocator ?? '',
    evidenceLevel: entry.evidenceLevel as TaxonomyEvidenceLevel,
    taxonomyVersion,
  }));

  const outputDir = path.resolve(input.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const taxonomyPath = path.join(outputDir, TAXONOMY_FILE);
  const manifestPath = path.join(outputDir, MANIFEST_FILE);

  writeCsvFile(
    taxonomyPath,
    TAXONOMY_COLUMNS,
    rows.map((row) => [
      row.techniqueId,
      row.craftDomain,
      row.lifecycleStage,
      row.titleKo,
      row.titleEn,
      row.definition,
      row.whenToUse,
      row.howToApply,
      row.pitfalls,
      row.anchorTermsKo.join('; '),
      row.anchorTermsEn.join('; '),
      row.signalHints.join('; '),
      row.sourceBook,
      row.sourceLocator,
      row.evidenceLevel,
      row.taxonomyVersion,
    ]),
  );

  const manifest: CraftBuildManifest = {
    taxonomyVersion,
    builtAt: new Date().toISOString(),
    sources: manifestSources,
    techniqueCount: rows.length,
    verifiedCount: rows.filter((row) => row.evidenceLevel !== 'unverified').length,
    unverifiedCount: rows.filter((row) => row.evidenceLevel === 'unverified').length,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });

  return {
    taxonomyPath,
    manifestPath,
    techniqueCount: rows.length,
    unverifiedCount: manifest.unverifiedCount,
    rejectedBookEntries,
    manifest,
  };
};

const parseJoined = (value: string): string[] => {
  return Array.from(new Set(
    value.split(';').map((term) => term.trim()).filter(Boolean),
  ));
};

export interface LoadedCraftTaxonomy {
  rows: CraftTaxonomyRow[];
  manifest: CraftBuildManifest | null;
  taxonomyPath: string;
}

/** Load taxonomy.csv + manifest for the analysis join; refuses when absent. */
export const loadCraftTaxonomy = (craftDir: string): LoadedCraftTaxonomy => {
  const dir = path.resolve(craftDir);
  const taxonomyPath = path.join(dir, TAXONOMY_FILE);
  const manifestPath = path.join(dir, MANIFEST_FILE);
  if (!fs.existsSync(taxonomyPath)) {
    throw new CraftTaxonomyMissingError(dir);
  }
  const records = parseCsvWithColumns(fs.readFileSync(taxonomyPath, 'utf8'));
  const seenIds = new Set<string>();
  const rows: CraftTaxonomyRow[] = [];
  for (const record of records) {
    const techniqueId = record.technique_id ?? '';
    if (!techniqueId || !CRAFT_DOMAINS.has(record.craft_domain ?? '') || !LIFECYCLE_STAGES.has(record.lifecycle_stage ?? '')) continue;
    if (seenIds.has(techniqueId)) continue;
    seenIds.add(techniqueId);
    rows.push({
      techniqueId,
      craftDomain: record.craft_domain as CraftDomain,
      lifecycleStage: record.lifecycle_stage as LifecycleStage,
      titleKo: record.title_ko ?? '',
      titleEn: record.title_en ?? '',
      definition: record.definition ?? '',
      whenToUse: record.when_to_use ?? '',
      howToApply: record.how_to_apply ?? '',
      pitfalls: record.pitfalls ?? '',
      anchorTermsKo: parseJoined(record.anchor_terms_ko ?? ''),
      anchorTermsEn: parseJoined(record.anchor_terms_en ?? ''),
      signalHints: parseJoined(record.signal_hints ?? ''),
      sourceBook: record.source_book ?? '',
      sourceLocator: record.source_locator ?? '',
      evidenceLevel: EVIDENCE_LEVELS.has(record.evidence_level ?? '') ? record.evidence_level as TaxonomyEvidenceLevel : 'unverified',
      taxonomyVersion: record.taxonomy_version ?? '',
    });
  }
  const manifest: CraftBuildManifest | null = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CraftBuildManifest
    : null;
  return { rows, manifest, taxonomyPath };
};

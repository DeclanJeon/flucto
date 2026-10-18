# Cinematic Craft Quality Benchmark Protocol

Status: proposed protocol; not evidence of achieved accuracy. This benchmark is for internal quality evaluation of Flucto's cinematic-analysis outputs. It does not authorize release of copyrighted media or public accuracy claims.

## 1. Benchmark design and sampling

Use two deliberately separate sets:

1. **Deterministic synthetic set:** locally generated, rights-cleared clips with known edit construction (hard cuts, fades/dissolves, flashes, continuous shots, and multiple camera cuts within one scene). Record the construction recipe and exact event times. This tests timing and algorithm behavior, not semantic vision quality.
2. **Human-reviewed visual set:** only clips with documented rights allowing this use (commissioned, public-domain with verified status, or explicit written license/consent). Include varied content and editing: dialogue, montage, animation, low light, fast cuts, transitions, and sustained scenes. Do not use downloaded reference videos absent explicit benchmark rights. Keep the set small initially (e.g. 12–20 clips, 2–5 minutes each); expand only with documented sampling rationale.

Choose clips before seeing model output. Stratify by content/edit category and difficulty, then sample clips/intervals within strata; record inclusion method, duration, exclusions, and whether cases are synthetic or human-reviewed. Avoid selecting only easy/clear examples. Freeze a versioned split: annotation/development and held-out evaluation. Do not tune thresholds or prompts on held-out labels. Report clip counts and event/shot counts; do not treat many correlated shots from one clip as independent samples.

## 2. Annotation procedure and independence

At least two reviewers independently annotate each human-reviewed clip, without seeing model outputs, one another's labels, taxonomy matches, or generated report. Use the same playback/tooling instructions and source timebase. Reviewers may replay the source; they must not infer hidden production facts. Annotate uncertainty rather than forcing a label. Record reviewer ID, date, protocol version, and tool/version. Reviewers disclose relevant conflicts/experience.

After independent annotation, a third reviewer or designated adjudicator resolves disagreements against the source, preserving both original annotations, the adjudicated value, rationale, and unresolved status. Do not silently overwrite disagreement. If no defensible resolution is possible, retain `unknown`/ambiguous and exclude only from metrics that require a determinate gold label; disclose exclusions. Model outputs may be compared only after gold annotations are frozen. Model-generated labels are never gold and may not be used to fill missing annotations.

## 3. Annotation rules and metrics

### Boundaries

Annotate each visible edit boundary's time in source seconds and source frame/timebase where available; distinguish hard cut, fade/dissolve, wipe/other transition, flash/ambiguous, and no boundary. For gradual transitions, record start/end interval as well as a conventional midpoint; mark uncertain intervals. Predeclare a timing tolerance (report frame-based tolerance where frame rate is known; otherwise milliseconds). Match predictions one-to-one to gold events within tolerance. Report precision, recall, F1, signed timing bias, median and 90th-percentile absolute error, and counts by transition class. Report false positives for flashes and gradual transitions separately. Never treat a scene-score candidate as a verified cut merely because it was emitted.

### Scene continuity

Annotate scene membership separately from shot boundaries. Define a scene as a contiguous narrative/action/location-time unit under the available visual evidence; a camera cut alone does not require a scene change. Mark ambiguous transitions. The primary unit is each immediately adjacent pair of adjudicated shots within a clip: label same-scene/different-scene and report the confusion matrix, per-class precision/recall/F1, and over-split/over-merge counts. Also report partition-level pairwise scores over all within-clip shot pairs; because same-scene pairs may dominate, report class counts and either use all pairs with class-specific metrics or a predeclared seeded, class-balanced sample, documenting its seed and sampling rule. Never pool pairs across clips. Use the adjudicated scene partition for primary metrics; also report inter-reviewer agreement before adjudication. Do not imply the annotation establishes narrative intent beyond what reviewers can observe.

### Semantic labels and abstention

Use a versioned field dictionary with allowed values and concise decision rules for each evaluated field (e.g. shot scale, subject kind, lighting, palette, composition, transition). Record evidence/time span and one of `observed`, `inferred`, `unknown`, or `not-applicable`; only directly visible attributes may be `observed`. Narrative function, intent, genre, equipment, and source workflow are not observable from pixels alone and must not be gold-labeled as fact. Allow multiple/ambiguous values where the dictionary permits; otherwise use `unknown`.

For each field report: eligible gold instances, system coverage (non-abstained eligible predictions / eligible instances), accuracy on covered instances, per-class precision/recall/F1 where meaningful, unknown/abstention rate, and error/coverage trade-off. Count invalid or missing predictions explicitly. Do not score `unknown` as correct merely because it avoids an error; report abstention separately. If confidence is supplied, evaluate calibration only on sufficient adjudicated data with a predeclared method; otherwise call it model-reported confidence, not probability.

### Taxonomy application precision

Gold-label only whether a taxonomy application is supported by the clip evidence and the cited technique definition, with reviewer rationale and evidence span. For every evaluated application, preserve the exact taxonomy artifact/version (and checksum or immutable revision), technique ID, anchor ID and exact anchor text, matched label text, matcher/version and matching path/diagnostics, and the analysis run/configuration. This is required to reproduce generic-anchor and substring-match errors; a technique ID and evidence note alone are insufficient. Compare emitted applications against adjudicated supported/unsupported/ambiguous labels; report application-level precision, false-positive count/rate, coverage, and per-category results. Report recall only when the annotation process has a defined complete candidate universe; otherwise state that recall is not estimable. Include negative cases with generic anchors and plausible but unsupported matches. A taxonomy entry's existence or matching text alone is not proof of application.

### Agreement and uncertainty

Before adjudication, report raw agreement and a suitable chance-adjusted statistic for categorical labels (e.g. Cohen's kappa for two reviewers, Fleiss' kappa for more; state handling of missing/unknown). For boundary times, report matched-event agreement, event-count disagreement, and paired timing differences; for scene grouping, report pairwise agreement. Include sample sizes and confidence intervals where appropriate. Small samples should be labeled exploratory; avoid overinterpreting unstable agreement statistics.

## 4. Privacy, rights, and reproducibility

Maintain a rights/consent record for every clip, permitted purposes, retention/deletion date, access restrictions, and any face/voice/privacy risk. Prefer synthetic media for algorithm tests; avoid unnecessary identifiable people, sensitive settings, or audio. Store source media only in access-controlled local storage. Do not commit media, frames, audio, transcripts, provider payloads, keys, auth files, or identifying source URLs. Repository artifacts may contain only approved minimal annotation metadata and synthetic fixtures; remove names/locations and use opaque clip IDs. Do not transmit benchmark media or frames to a model/provider as part of annotation or evaluation unless separately authorized under an approved protocol; this protocol itself authorizes no such transmission.

Record source checksum in the private benchmark ledger, not necessarily the repository; tool/model/version, provider and model identifier, prompt/configuration hashes (never credentials), Flucto code revision, schema/field-dictionary/taxonomy versions, split, sampling method, run ID, and metric implementation. Link every prediction to its gold clip/time span/field and record the prediction or explicit abstention, so errors and coverage are reproducible. Re-run comparisons on the same frozen set and disclose changes to annotations or protocol.

## 5. Reporting and claim limits

Every report states dataset composition, rights basis, sampling, split, annotation protocol/version, reviewer count, adjudication, denominators, exclusions, metrics, uncertainty, and known limitations. Separate synthetic algorithm tests from human-reviewed semantic results. Publish no metric without its denominator and evaluation set. Do not claim universal accuracy, reliable scene understanding, calibrated confidence, inferred source intent/tools, or provider availability from this benchmark. Results support only the tested task definitions, media distribution, model/configuration, and benchmark version. Passing synthetic tests establishes implementation behavior on those constructions—not real-world accuracy. Until an approved representative gold set and review gate exist, label accuracy as **unverified**.

## 6. Minimal annotation record template

Copy this JSON object per clip (or maintain one record per clip in a local JSONL file). Replace placeholders; do not check in records that identify restricted media. `annotations` is intentionally empty until independent human review. Keep the private rights ledger separate if it contains sensitive source details.

```json
{
  "benchmarkId": "cinematic-craft-v1",
  "protocolVersion": "1.0.0",
  "fieldDictionaryVersion": "field-dictionary-v1",
  "taxonomy": {
    "artifactVersion": "",
    "immutableRevisionOrPrivateChecksum": "",
    "matcherVersion": "",
    "anchorSetVersion": ""
  },
  "clipId": "opaque-clip-001",
  "set": "synthetic|human-reviewed",
  "source": {
    "provenance": "synthetic recipe or private ledger reference",
    "rightsBasis": "synthetic|public-domain-verified|written-permission",
    "licenseOrConsentReference": "private ledger ID; do not include secret URL",
    "permittedUse": ["local annotation", "internal evaluation"],
    "retentionUntil": "YYYY-MM-DD",
    "sourceDurationSeconds": null,
    "timebase": "e.g. 25 fps CFR; otherwise describe",
    "privateChecksumReference": "private ledger reference; omit raw media"
  },
  "sampling": {
    "stratum": "dialogue|montage|animation|low-light|other",
    "selectionMethod": "predeclared method",
    "split": "development|held-out",
    "inclusionRationale": "",
    "exclusions": []
  },
  "reviewers": [
    {
      "reviewerId": "R1",
      "role": "independent-annotator|adjudicator",
      "reviewedAt": "YYYY-MM-DD",
      "toolVersion": "",
      "conflictDisclosure": "none|describe",
      "sawModelOutput": false
    },
    {
      "reviewerId": "R2",
      "role": "independent-annotator|adjudicator",
      "reviewedAt": "YYYY-MM-DD",
      "toolVersion": "",
      "conflictDisclosure": "none|describe",
      "sawModelOutput": false
    }
  ],
  "evaluationRun": {
    "runId": "",
    "codeRevision": "",
    "schemaVersion": "",
    "provider": "",
    "modelId": "",
    "promptHash": "",
    "configurationHash": "",
    "credentialOrSecretIncluded": false,
    "predictions": []
  },
  "annotations": {
    "boundaries": [],
    "sceneMembership": [],
    "semanticLabels": [],
    "taxonomyApplications": [],
    "adjudications": []
  },
  "privacyReview": {
    "identifiablePeopleOrVoices": false,
    "sensitiveContent": false,
    "mitigations": [],
    "repositorySafeMetadataOnly": true
  }
}
```

Suggested entries: boundary `{reviewerId,startSeconds,endSeconds,midpointSeconds,type,certainty,evidenceNote}`; scene membership `{reviewerId,startSeconds,endSeconds,sceneLabel,certainty,evidenceNote}`; semantic label `{reviewerId,startSeconds,endSeconds,field,value,evidenceLevel,certainty}`; taxonomy application `{reviewerId,startSeconds,endSeconds,techniqueId,anchorId,anchorText,matchedLabel,matcherVersion,matchingPath,judgment:supported|unsupported|ambiguous,evidenceNote}`; prediction `{predictionId,goldItemRef,field,predictedValue,abstained,modelReportedConfidence,matchedAnchorId,matchedLabel,matchingPath}`; adjudication `{itemRef,adjudicatorId,finalValue,rationale,unresolved}`. Do not place frame bytes, credentials, identifying provider payloads, or recognizable personal information in notes or records.

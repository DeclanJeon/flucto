# Cinematic Craft Analysis: Real-Provider QA and Accuracy Work Order

- Status: proposed implementation plan; not a release sign-off
- Owner: Flucto cinematic-analysis maintainer
- Model for delegated Pi work: `openai-codex/gpt-6-luna`
- Related design: `docs/cinematic-craft-analysis-design.md`
- Existing implementation plan: `docs/cinematic-craft-production-work-order.md`

## 1. Goal

Turn the first real-provider run into a reproducible quality-improvement cycle. Preserve the distinction between measured signals, visible observations, model interpretations, source-confirmed facts, and unknowns. Improve report traceability and false-positive resistance before broadening product claims. Do not imply that a successful API response proves scene accuracy.

## 2. Baseline evidence

Real-provider run completed on 2026-10-18 against the locally downloaded reference video, using OpenCode `opencode/glm-5.3-flash-free` after explicit consent to transmit frames:

- Source: `/home/declan/Documents/flucto/sources/AI 병맛 로판 EP.4 [빙의는 했는데 얼굴이 따라왔습니다].mp4`
- Run directory: `/home/declan/Documents/flucto/AI_병맛_로판_EP.4_빙의는_했는데_얼굴이_따라왔습니다-craft-20261018-142930/`
- Canonical output: `analysis.json`; CSVs and manifest are in the same directory.
- 158-second source; 59 detected shot segments; 58 vision-labeled; 1 signal-only; API budget not exceeded; report status `partial`; elapsed time approximately 5m44s.
- 59 scenes for 59 shots; all exported `boundaryType` values were `unknown`.
- 177 production tasks; one taxonomy technique application; DaVinci Resolve and Blender tool recommendations.
- Manifest says `externalFrameTransmission: true`; frame bytes were not persisted in the report.
- An 8-second provider smoke test also succeeded: 4 segments, 1 labeled under a one-call cap, 3 signal-only, expected budget-partial status.

This is an integration smoke test, not an accuracy benchmark. The existing downloaded video and report are user data and must not be copied into the repository or committed.

## 3. Confirmed findings to investigate

1. **Inferred-claim confidence is lost during serialization.** The vision parser only accepts labels when a numeric model confidence meets `VISION_CONFIDENCE_FLOOR`, but the report's generic claim builder writes `confidence: null` for every `INFERRED` claim. Trace the confidence field end-to-end. Preserve it as model-reported confidence (not calibrated probability), or explicitly record it as unavailable; never silently imply calibration.
2. **Segmentation is not independently validated.** The run has 59 shots and 59 scenes, with no exported boundary type except `unknown`. Review whether this is correct for the source and whether useful cut-candidate scores/evidence are hidden or lost. Do not upgrade candidates to observed hard cuts without a two-sided visual check.
3. **Scene grouping may be too conservative.** The current adjacent-label heuristic did not merge any shots. Test with known-continuous and known-discontinuous examples; separate shot boundaries from scene boundaries and expose uncertainty.
4. **Taxonomy matching may produce generic-token false positives.** The only match was `CTX-PRE-421a6e75`, titled “Production·Post-production·Distribution 기록,” apparently linked through generic “Production” text. Trace the exact match path and add regression coverage. Do not delete or alter unrelated taxonomy content.
5. **Vision interpretation needs review discipline.** Some generated narrative descriptions (for example, a “food vlog/review” reading of the opening food shot) go beyond visible facts. Keep narrative function explicitly inferred, avoid source intent/genre assertions without evidence, and make low-evidence fields unknown.
6. **External OpenCode server warning.** The test's standalone loopback `opencode serve` warned that `OPENCODE_SERVER_PASSWORD` was unset. Loopback binding limits exposure but is not authentication. Determine the safest supported authenticated local-server configuration; do not put credentials in shell history or logs.

### Independent code-review QA (Pi, `openai-codex/gpt-6-luna`, read-only)

Two reviewers inspected the current implementation and artifact without editing files. Their findings refine the work packages above:

- `src/main/services/visionProvider.ts` parses confidence, rejects labels below `VISION_CONFIDENCE_FLOOR`, and returns accepted confidence in `labels.confidence`. `src/main/services/cinematicAnalysis.ts` also writes it to the legacy shot-log field `label_confidence`. However, `src/main/services/analysisReport.ts`'s `claim()` helper sets all `INFERRED` confidence to `null`, and the vision-claim call does not pass the score. The structured JSON and `shots.csv` therefore lose it. The baseline contains 614 inferred claims with null confidence. This is a serialization defect; the provider score remains uncalibrated.
- `src/main/analysis/ffmpegSignals.ts` emits estimated cut candidates with time/score; `segmentShots` uses candidates to split windows while keeping only a coarse cut type. `analysisReport.ts` exports `hard-cut` only for internal `HARD-CUT` and otherwise `unknown`, with null `boundaryConfidence`; candidate time/score/method are not preserved in the report. Thus candidate segmentation changes shot counts without an auditable candidate record. Do not label candidates as verified cuts merely to avoid `unknown`.
- `groupShotsIntoScenes` in `src/main/services/cinematicAnalysis.ts` merges adjacent shots only when at least two of subject, palette, and lighting match, and does not expose ambiguity or alternatives. It can over-split continuous scenes and over-merge unrelated adjacent shots. Shot and scene IDs must remain distinct concepts.
- `matchTechniques` builds text from string labels and uses `includes(anchor)`. Taxonomy anchor generation/merging can retain generic title fragments. Add negative tests for generic anchors and substring collisions; retain specific positive cases and multilingual coverage. The exact anchor responsible for baseline `CTX-PRE-421a6e75` was not independently verified, so treat the suspected generic “Production” path as a hypothesis until reproduced.
- The manifest's external-transmission flag is currently derived from enabled/configured vision provider, not observed successful frame requests. The run status is `partial`, but the report does not include actual provider call count or a per-shot failure/partial reason. Align manifest, report, and CLI with observed request outcomes.
- Clarify retry accounting before acceptance: a retry must be bounded and counted against the same API budget; define behavior for session creation success followed by message failure. A failed/low-confidence model response must remain signal-only/unknown and must not duplicate IDs on retry.

## 4. Work packages

### WP1 — Claim confidence and provenance

- Trace model confidence from `parseVisionCompletionJson` through `ShotObservation`, report JSON, CSV, and UI.
- Add a focused regression test using a known confidence value (e.g. 0.82); assert that the inferred claim carries it and remains `INFERRED`.
- Document that this is the model's self-reported score and is not calibrated until validated against reviewed data.
- Keep signal-derived `OBSERVED` confidence and `UNKNOWN` semantics unchanged.
- Ensure missing/invalid/low-confidence values remain unknown and cannot be converted into facts.

**Acceptance:** generated JSON and `shots.csv` agree; the accepted model score is traceable as explicitly uncalibrated (or consistently unavailable in both); schema and cross-reference checks pass; no frame bytes or secrets are persisted.

### WP2 — Shot-boundary diagnostics and scene grouping

- Trace candidate generation, shot windows, `cutType`, `boundaryType`, confidence and CSV fields.
- Preserve candidates as estimated unless supported by an independently defined verification rule. Candidate time/score/method must survive from `toCutCandidates` through shot segmentation into JSON and CSV; expose adjacent-frame evidence and review state instead of silently presenting only `unknown`.
- Add deterministic fixtures for hard cuts, gradual fades, no-cut continuous shots, flashes, and a continuous scene containing multiple camera cuts.
- Keep scene grouping independent from shot detection. Test both scene continuity and deliberate scene changes; surface alternate grouping/uncertainty where evidence is ambiguous.
- Measure timing tolerance on fixtures and report limitations rather than claiming a target score without benchmark data.

**Acceptance:** shot and scene IDs are distinct concepts; candidate metadata is auditable end-to-end; fixtures demonstrate no false promotion of uncertain cuts and surface ambiguous scene grouping rather than silently resolving it.

### WP3 — Taxonomy matcher precision

- Trace why the baseline taxonomy row matched, including the exact matched anchor and label text.
- Add a negative fixture for generic words such as “production,” “cinematic,” “camera,” and “edit” matching unrelated taxonomy entries.
- Require sufficiently specific, non-duplicated anchors and a minimum evidence threshold; reject generic anchors and substring collisions; retain rejected candidate diagnostics for QA but do not emit them as applications.
- Make an application claim explicitly a candidate inference requiring human confirmation.

**Acceptance:** the baseline false-positive hypothesis is reproduced or explicitly cleared by examining the exact matched anchor; generic-anchor negatives are rejected; valid specific positive fixtures continue to match; no unsupported tool/intent claims.

### WP4 — Provider/error handling and safe local runtime

- Add or improve tests for malformed JSON, missing confidence, low confidence, timeout, HTTP error, provider/model unavailable, and per-shot partial failure.
- Ensure failed shots remain signal-only, error summaries are safe, and retry does not duplicate report entities or API calls beyond the configured budget.
- Verify the documented OpenCode server auth behavior. Prefer the bundled authenticated runtime; for CLI local-server use, support/describe authentication if OpenCode exposes it. Do not weaken the loopback binding or log API keys.
- Report external frame transmission from observed frame requests (not merely configuration), plus model ID, actual call count, per-shot outcome, and partial reason accurately in JSON/manifest/CLI summary.
- Define bounded retry semantics and count all model message attempts against the configured budget, including failed message attempts; avoid charging only successful responses or silently retrying outside the cap.

**Acceptance:** no secret appears in logs/artifacts; tests assert timeout/error and partial status; consent is required before any frame request.

### WP5 — QA benchmark and release gate

- Create a small, rights-cleared/synthetic benchmark before claiming accuracy. Include known cut/scene labels and a concise annotation guide. Never commit the downloaded YouTube source, frame images, key, auth file, or private provider payload.
- Separate deterministic synthetic tests (for algorithm correctness) from human-reviewed visual examples (for semantic quality). Store only authorized, minimal metadata when licensing permits.
- Report per-field coverage and reviewer agreement. Do not publish precision/recall/calibration values until there is a reviewed gold set with a documented sampling method.
- Run `npm run build:electron`, `npm run lint`, and `npm test`; run a live-provider check only when the user explicitly authorizes outbound frames and a configured account is available.
- Inspect JSON and every CSV for dangling references, evidence-level consistency, empty/partial rows, and stable IDs.

**Acceptance:** all automated checks pass; live-provider E2E is separately recorded with model/date/call count and partial errors; accuracy remains marked unverified until the benchmark is approved.

## 5. Execution order and coordination

1. Review current code and the baseline artifact read-only; do not assume or revert existing worktree changes.
2. Implement WP1 and WP3 first (small, testable correctness fixes).
3. Implement WP2 diagnostics/fixtures; avoid changing cut labels solely to make the report look complete.
4. Complete WP4 and WP5 QA.
5. Run the full suite and review the diff. Stage only files intentionally changed for this work order. The working tree may contain unrelated user/agent changes and `.from-backup` files; do not clean, restore, stage, or commit them.
6. Re-run the real-provider analysis only after changes that affect its output, and only with explicit frame-transmission consent. Use an API-call cap and stop if access, quota, cost, or privacy expectations are unclear.

Delegated Pi agents must use `openai-codex/gpt-6-luna`, stay within the assigned work package, and report paths/tests/findings. Avoid concurrent edits to the same files. A read-only reviewer should first identify exact code locations and minimal regression tests; the coordinator owns integration and final QA.

## 6. Release position

The real-provider request path is proven to work. Accuracy, scene grouping, cut classification, taxonomy precision, confidence reporting, and cross-platform authenticated runtime behavior are not yet proven. Keep cinematic analysis labeled as an expert-review/partial feature until the relevant gates above pass.

## 7. Current implementation and QA state

Completed locally during this work order (not staged or committed):

- WP1: structured inferred claims now carry the parser-accepted model-reported confidence; the claim reason says it is uncalibrated. JSON and `shots.csv` regression assertions cover confidence `0.8` and unknown/null behavior.
- WP3: matcher reads label values rather than field names, deduplicates anchors case-insensitively, rejects the listed generic anchors as sole evidence, and uses whole-word/phrase matching to prevent substring-only hits. Regression tests cover the observed duplicate `Production` false-positive path, generic anchors, substring collision, case-variant duplicates, and a specific positive anchor.
- Two independent read-only QA passes were run with Pi `openai-codex/gpt-6-luna` via Herdr; their findings are incorporated above. One reviewer then implemented WP1 and the other WP3 within the stated file scopes.
- Verification after these changes: `npm run lint` passed; `npm test` passed (190 tests, including electron build and the new regression coverage).

Still open: WP2 boundary/scene evidence and quality benchmark; WP4 observed transmission/call-count/partial-error accounting and authenticated server behavior; WP5 rights-cleared gold-set and accuracy review. The real-provider artifact predates WP1/WP3 and must not be presented as if it contains the fixes. A fresh run should wait until the remaining output/reporting gaps are addressed and should use explicit frame-transmission consent.

The repository has extensive unrelated modifications and `.from-backup` files. Do not stage or commit this work order or the targeted code edits until the owner reviews the complete working-tree diff and selects only the intended files.

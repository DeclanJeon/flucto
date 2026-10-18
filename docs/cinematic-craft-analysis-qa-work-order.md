# Cinematic Craft Analysis: Real-Provider QA and Accuracy Work Order

> **Current scope:** OpenCode runtime support was retired; historical OpenCode QA below documents past runs only. The application now offers Codex CLI subscription auth (desktop and CLI) and explicitly configured OpenAI-compatible endpoints (CLI). Post-retirement CI and Package Validation passed on Windows, macOS, and Ubuntu; the macOS package smoke ran on Intel. Real-video AV analysis remains verified only on Linux x64, and no provider integration establishes analysis accuracy.

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
- **Addressed in the current working diff:** the manifest's external-transmission status is now based on observed frame requests/responses, not merely provider configuration. Reports include attempted model calls, per-shot outcomes, and partial reasons; see WP4 status below.
- **Addressed in the current working diff:** model message attempts (including failed HTTP/network attempts) consume the same bounded budget. OpenCode session creation is not counted as a model call; a failed message attempt is counted. A failed/low-confidence response remains signal-only/unknown.

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

A historical authorized run demonstrated that the provider request path could return labels, but the later 2026-10-18 re-test was rejected by the gateway with HTTP 403. Current provider availability is not proven. Accuracy, scene grouping, cut classification, taxonomy precision, confidence reporting, and cross-platform authenticated runtime behavior are not yet proven. Keep cinematic analysis labeled as an expert-review/partial feature until the relevant gates above pass.

## 7. Current implementation and QA state

Completed locally during this work order (working diff, not yet committed):

- WP1: structured inferred claims carry accepted model-reported confidence and explicitly label it uncalibrated. JSON and `shots.csv` tests cover confidence and unknown/null behavior.
- WP3: matcher reads label values, deduplicates anchors case-insensitively, rejects generic anchors as sole evidence, and uses whole-word/phrase matching. Tests cover generic/duplicate anchors, substring collisions, and specific positive matches.
- WP2 diagnostics: outgoing cut candidates preserve time, score, method, and estimated/review state through shot JSON and CSV without promoting them to verified boundaries. Shot-to-scene grouping is separate from cut detection and has deterministic grouping tests. The heuristic still needs human-reviewed continuity examples and richer uncertainty/alternative-grouping treatment.
- WP4 reporting and safety: attempted model-call counts, per-shot vision outcomes/failure codes, partial reasons, request destinations, and observed request/response status are serialized in JSON and manifest and surfaced by the CLI. Failed message attempts consume budget; OpenCode session creation does not. CLI local-server requests require Basic credentials and loopback HTTP; frame-bearing requests do not follow redirects. Tests cover auth, redirect behavior, request accounting, error outcomes, and report serialization. This is mock/test coverage, not verification against a live OpenCode server.
- The user guide now distinguishes the desktop-managed runtime from a separately started authenticated CLI server.
- Two independent read-only QA passes were run with Pi `openai-codex/gpt-6-luna` via Herdr; their findings are incorporated above. One reviewer implemented WP1 and another WP3 within scoped files.
- Latest verification after Codex CLI adapter work: `npm run lint`, `npm test` (221 passed, 1 env-gated real-media test skipped by default), and `npm run build` passed. The Linux x64 AppImage + CLI setup package passed the local package smoke with cleanly provisioned FFmpeg/FFprobe; Codex app-server mock tests and local image-model catalog discovery pass. Other native package gates remain unpassed.

### Authorized live-provider re-test (2026-10-18)

The user explicitly authorized another frame-transmitting test. The isolated, authenticated loopback CLI server used a temporary copy of the existing OpenCode auth file and temporary OpenCode data/config/state directories; the server was stopped and its temporary storage removed afterward. No credentials were printed or committed.

- Source: the existing local 157.5-second video identified in section 2. The CLI dry-run estimated 59 shots, 177 frames, and 59 model calls; the run cap was 60.
- Run directory: `/home/declan/Documents/flucto/AI_병맛_로판_EP.4_빙의는_했는데_얼굴이_따라왔습니다-craft-20261018-214536/`.
- Full local pipeline completed and emitted all 10 artifacts for 59 shots. `analysis.json` passes the current JSON schema and cross-reference checks; manifest status/call counts match the report. No frame image files were persisted.
- OpenCode returned an assistant-level API error with gateway status 403: `Forbidden, OpenCode Free Model Gateway Detect Abuse Traffic`. Five frame-bearing model attempts were made before the then-current five-error stop condition; zero shots were labeled and the rest were skipped. A separate text-only availability probe using the catalog-listed free vision model `mimo-v2.6-flash-free` received the same 403. No further model requests were made.
- The historical run artifact records these as `malformed-response` because the provider error was embedded in an HTTP-200 OpenCode assistant response. The current code now recognizes embedded 401/403 provider rejections as `provider-rejected` and aborts the run immediately; regression coverage passes. The historical artifact predates this classification fix.
- Frames were sent to the authenticated local OpenCode server as authorized. Whether OpenCode forwarded those rejected requests onward is unknown; the report conservatively records `externalOnwardTransmission: null`.
- A fresh `flucto doctor --json` check showed the managed installation has no `ffprobe`. The live run used a temporary matching FFmpeg/FFprobe 7.0.2 pair. Pinned FFmpeg/FFprobe sources and archive SHA-256 verification are implemented for Windows x64, Linux x64/arm64, and macOS x64/arm64 in both CLI and package setup. Offline tests cover digest mismatch, safe extraction limits, pairing, deduplicated downloads, and rollback. A separate real Linux x64 test used the pinned archive already fetched into temporary storage, verified its digest, installed the pair through runtime `setupUtilities`, exercised the package TAR extractor with cached decompression, probed generated media, extracted in-memory JPEG frames, and completed a compiled CLI run against a local mock. This reproduced and fixed FFmpeg 9's removal of `-vsync 0` by switching to `-fps_mode passthrough`. Other platform/native package smoke, license/provenance review, and release-package acceptance remain open. `scripts/package-smoke.mjs` asserts FFprobe is present and probes a generated rawvideo/NUT fixture; it later passed against a locally built Linux x64 AppImage and CLI setup package. Other platform and release acceptance gates remain open.

Latest verification: `npm test` passed (221 passed, 1 env-gated real-media test skipped by default); `npm run build` and `npm run lint` passed; scoped `git diff --check` passed. The real Linux x64 media test separately passed against the pinned archive, and the clean Linux x64 AppImage/CLI package smoke passed locally. Windows/macOS/arm64 package matrix and GPL review remain open. Unscoped `git diff --check` reports CRLF trailing-whitespace warnings in the pre-existing `src/main/services/mediaDownload.ts` change, which remains untouched. Linux x64 checks do not prove other-platform packaging or analysis accuracy.

### Codex CLI provider development and capped smoke

The user chose Codex CLI subscription auth instead of relying on the blocked OpenCode gateway. Local `codex app-server` model discovery returned eight image-capable models without an inference request. The new provider uses ephemeral, read-only app-server turns and sends JPEG data URLs in memory; Codex credentials are not copied or saved by Flucto. Mock protocol, response parsing, request accounting, and unknown onward-transmission tests pass.

The initial user-authorized three-call smoke with `gpt-6-luna` returned zero labels and `network-error`; investigation found the wrong `turn/start.sandboxPolicy` shape (`read-only` string instead of `{type:'readOnly', networkAccess:false}`). After that fix, the user approved a one-call smoke. It returned a Codex completion and one label out of 59 shots, with 58 left signal-only at the budget limit. The report passed schema/reference validation, had no persisted frame image files, and recorded onward transmission as unknown. This is an integration check, not accuracy evidence.

The successful run output is under `/tmp/flucto-codex-corrected-smoke/AI_병맛_로판_EP.4_빙의는_했는데_얼굴이_따라왔습니다-craft-20261019-034718/`. It was generated before fixing a report attribution defect and says `opencode/gpt-6-luna` although Codex CLI was used. The source and mock test are now corrected to report `codex-cli/gpt-6-luna`; do not treat the old artifact's provider name as accurate. The failed-run artifact's `externalOnwardTransmission:false` is also stale; transmission is unknown.

Still open: Windows/Linux arm64/macOS native archive and package smoke plus GPL redistribution review; provider-specific package validation and visual boundary/scene quality validation; rights-cleared human-reviewed benchmark and accuracy review. Accuracy claims remain blocked until an approved benchmark exists.

Unrelated prior changes remain preserved in `stash@{0}`; do not apply or delete them wholesale. Review the complete diff and stage only intentional files.

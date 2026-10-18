# Cinematic Craft Analysis — Completion Work Order

- Status: **active; not release-ready**
- Coordinator: cinematic-analysis maintainer
- A2A workers: `qa-quality` and `platform-review` (Pi `openai-codex/gpt-6-luna`, Herdr-managed, same repository/cwd)
- Existing QA evidence: `docs/cinematic-craft-analysis-qa-work-order.md`
- Product plan: `docs/cinematic-craft-production-work-order.md`

## Goal and definition of done

Make the supported workflow reliable from setup and consent through analysis and reviewable exports, with tested error paths and bounded product claims. “Done” means all applicable acceptance gates in this document pass and remaining external/human gates are recorded as blockers—not silently waived. No model response is treated as verified fact, and a successful provider request is not an accuracy result.

A release cannot be called complete while any of these hold:

1. a supported OS cannot install or package a compatible FFmpeg/FFprobe pair and run the probe;
2. desktop/CLI OpenCode request isolation, authentication, cleanup, and no-redirect behavior are unverified;
3. a successful end-to-end provider response has not produced a schema-valid report under an explicitly authorized run;
4. output references/provenance, consent, failure/partial reporting, or artifact privacy checks fail;
5. reviewed quality evidence is absent but accuracy/production-quality claims are made.

Provider availability and licensed human annotations are external dependencies. Do not bypass gateway policy, use a paid provider, or transmit to a different provider without the user's authorization for that provider/cost.

## Baseline and constraints

- The current worktree contains uncommitted cinematic-analysis changes and a prior user change in `src/main/services/mediaDownload.ts`. Preserve them; do not reset, blanket-stage, or apply/drop `stash@{0}`.
- Latest verification after Codex adapter and Linux package-smoke work: `npm test` passed (221 passed, 1 env-gated real-media test skipped by default); `npm run build` and `npm run lint` passed. A cleanly provisioned Linux x64 AppImage + CLI setup package passed `scripts/package-smoke.mjs`; other native package targets remain unverified.
- The authorized OpenCode live run emitted a 59-shot `partial` report with 0 labels after five frame-bearing attempts. OpenCode's assistant response contained gateway HTTP 403 `Detect Abuse Traffic`; a text-only probe of another listed free vision model received the same rejection. Do not retry until access is restored. Do not interpret the historical `malformed-response` artifact as current error classification.
- Codex CLI `0.163.0` is installed locally; its app-server model catalog lists image-capable models. The first 3-call source-video smoke returned 0 labels because the `sandboxPolicy` RPC shape was wrong; that shape was corrected. With renewed user approval, a bounded 1-call smoke then returned a completion and labeled 1 of 59 shots. The JSON schema and evidence references validated, no frame files were present, and onward transmission remains unknown. This verifies integration only, not label accuracy. The generated smoke report exposed a provider-name attribution bug (`opencode/gpt-6-luna`); source and mock assertions now label Codex correctly, but the old artifact predates that metadata fix.
- The recorded live artifact is under the user's Documents/`flucto` folder, not the repository. No frame files were persisted; whether the OpenCode gateway received rejected frame payloads remains unknown.
- `flucto doctor --json` found no FFprobe in the currently managed install. The last live analysis used a temporary matching FFmpeg/FFprobe pair. Pinned FFmpeg/FFprobe archive sources and SHA-256 checks are configured for Windows x64, Linux x64/arm64, and macOS x64/arm64; see `docs/cinematic-craft-ffprobe-source-research.md`. Linux x64 pair execution and packaged CLI/AppImage smoke now pass; other platform packages remain unverified, and GPL redistribution/legal review is still open. `resolveFfprobePath()` assumes FFprobe sits beside FFmpeg.
- Rights-cleared visual gold labels are not available. The downloaded reference is user data; never commit it, its frames, provider payloads, auth files, or credentials.

## Prioritized work packages

### WP0 — Preserve scope and reconcile current state (coordinator)

1. Review the complete diff before integration; distinguish changes already present in the working tree from new worker changes.
2. Keep this work order and the QA work order synchronized. Clearly label historical successful and failed provider runs separately.
3. Do not claim cross-platform support based on URL-name tests or TypeScript compilation alone.

**Acceptance:** no unrelated files are lost; docs report one consistent current state and list all blockers.

### WP1 — Secure, complete binary setup and packaging (P0; platform worker owns package smoke)

1. Establish verified FFprobe sources or a bundled-source policy for every supported OS/architecture. If no verified source exists, fail clearly and do not imply that platform is supported for analysis.
2. Provision/extract to a temporary sibling path, validate executable/version and probe functionality, then atomically replace the destination. Failed downloads, invalid archives, path-traversal entries, interrupted extraction, and concurrent setup must not leave or overwrite a partial working binary.
3. Ensure desktop and CLI packages contain the intended matching FFmpeg/FFprobe pair. Extend `scripts/package-smoke.mjs` to assert both exist, execute `-version`, and probe a generated tiny media fixture. Include OpenCode binary/version presence without making a provider call.
4. Test actual archive extraction and installation from local fixtures; URL selection tests alone are insufficient. Add native CI/package smoke for Linux, Windows, Intel macOS, and Apple Silicon macOS (or explicitly remove unsupported targets from the feature's support claim).
5. Ensure `doctor`, `setup`, custom `--bin-dir`, and explicit `--ffmpeg` diagnostics agree with the actual installation behavior.

**Acceptance:** clean-install and packaged smoke passes on each claimed target; FFprobe parses a generated fixture; setup failure leaves no corrupt destination; missing/unsupported sources are reported honestly.

### WP2 — Authenticated runtime, privacy, and lifecycle (P0; platform worker audits, coordinator integrates)

1. Keep all frame requests loopback-only where using `opencode-local`; require Basic credentials and reject non-loopback/credential-embedded/HTTPS endpoints as currently designed. Never follow frame-bearing redirects.
2. Verify server-side authentication, not only that Flucto sends an Authorization header. For desktop, confirm credentials are per-run, not in argv/logs/settings, and OpenCode data/config/state/cache are isolated. For CLI external-server mode, document that Flucto cannot guarantee the listener's identity or server-side auth unless verified by a controlled server test.
3. Test normal shutdown, startup failure, spawn error, timeout, forced termination, and cleanup. No temporary credentials/session/frame data may remain after shutdown or error.
4. Check packaged OpenCode assets/hash validation and actual executable resolution for each supported OS/architecture.

**Acceptance:** controlled local-server tests prove Flucto sends credentials and handles unauthenticated rejection/authenticated success; packaged smoke must still prove the bundled listener enforces auth. Frame redirects are not followed; runtime directories and child processes are cleaned on tested exits; no secret/frame bytes in persistent logs/settings/artifacts.

### WP3 — Provider response/error policy and complete report lifecycle (P0; coordinator)

1. Preserve classification of OpenCode HTTP-200 assistant-level 401/403 errors as `provider-rejected`; stop the run promptly and make no additional frame calls after a non-retryable rejection.
2. Keep retry policy explicit and bounded. Count each attempted model message against one run-wide budget; do not count session creation as a model call; no hidden retries.
3. Make run status/partial reason and per-shot status consistent across `analysis.json`, manifest, CLI summary, and CSV. Unknown external onward transmission remains `null` unless demonstrably known.
4. Exercise success, valid high-confidence labels, valid empty output, malformed JSON, timeout, network failure, HTTP 401/403/429/5xx, provider/model unavailable, budget exhaustion, aborted remainder, and frame extraction failure.
5. Add a local mock-server **full CLI integration test** using an isolated fixture and fake media tools; emulate the authenticated OpenCode session/message protocol, return deterministic schema-valid labels, validate outputs, and verify frame bytes only reach the local test server. A compiled-CLI process test now exercises argument parsing/dispatch and explicit-consent/no-consent behavior. It is a software-path test, not model-quality evidence; the fixture does not decode media.

**Acceptance:** mock success path and partial/failure paths produce schema-valid, cross-reference-valid reports; call counts and reason codes match actual attempts; all tests enforce no duplicate entities and no secret/payload persistence.

### WP4 — Shot boundaries, scene grouping, and taxonomy provenance (P1; QA worker designs benchmark; coordinator owns source integration)

1. Preserve estimated cut-candidate time/score/method and review state; do not promote unverified cuts to facts.
2. Keep shot boundaries and scene grouping distinct. Expose unknown/ambiguous grouping; do not imply the current adjacent-label heuristic is a validated scene detector.
3. Reproduce or clear the suspected generic taxonomy match using exact taxonomy version, anchor, label and matching path. Preserve rejected-candidate diagnostics for QA; keep user taxonomy/source files unchanged.
4. Add deterministic tests for hard cuts, fades, continuous shots, flashes, multiple cuts in one scene, scene changes, generic anchors, substring collisions, and multilingual/specific positives.

**Acceptance:** exact diagnostics are auditable, no false promotion occurs in fixtures, and unresolved scene assignments remain explicitly uncertain.

### WP5 — Accuracy benchmark and claim gate (P1; QA worker owns protocol, coordinator requests human review)

1. Create `docs/cinematic-craft-benchmark-protocol.md`: rights policy, sampling plan, annotation schema, guidance for shot vs scene labels, reviewer independence/adjudication, and field-level unknown policy.
2. Add only synthetic/rights-cleared minimal fixtures to the repository. Keep actual reference-video labels locally unless licensing permits sharing.
3. Separate deterministic algorithm tests from human-reviewed visual examples. Have a qualified human review the selected examples and record reviewer agreement and adjudication; model-generated labels cannot serve as their own ground truth.
4. Report coverage and errors by field, boundary timing tolerance, scene continuity errors, taxonomy match precision, and uncertainty/abstention behavior. Do not claim calibration unless a separate calibration study supports it.

**Acceptance:** benchmark annotation guide and rights/provenance are approved; results and limitations are human-reviewed; until then the product and docs state accuracy is unverified.

## A2A orchestration and ownership

- Coordinator owns architecture, work-order edits, shared-source integration, full-suite runs, diff review, user-data/security boundaries, and final release decision.
- `platform-review` owns WP1 package-smoke changes and scoped WP2 runtime/package-smoke changes after explicit coordinator reassignment. It must not edit other shared files without reassignment.
- `qa-quality` owns WP5 benchmark protocol, deterministic integration tests, and read-only A2A cross-review. Changes to `cinematicAnalysis.ts`, `analysisReport.ts`, or shared tests require explicit coordinator reassignment; reassignment was granted for the CLI dispatch test.
- A2A procedure: workers report exact files/tests; coordinator passes each worker's findings to the other for independent cross-review; disagreements are returned to both before code is accepted. Recent cross-review rejected the unverified FFprobe-source implementation, retained its useful package-smoke assertions, identified Windows portability and scope limits in the mock pipeline test (subsequently addressed with the existing spawn shim and narrower claims), and requested taxonomy/run provenance fields in the benchmark protocol (added). No worker may run a live provider, send media, install binaries on the host, stage, or commit.
- Use Herdr-managed Pi sessions in this repository/cwd. Preserve the caller pane/focus. Monitor lifecycle with Herdr; inspect full responses from session output when terminal views truncate.

## Execution sequence and gates

1. **Design gate:** coordinator reconciles current diffs and publishes this work order; workers cross-review boundaries and acceptance criteria.
2. **Installer/package gate:** implement and locally-fixture-test WP1; package smoke/native CI proves platform binary presence and use.
3. **Runtime/error gate:** implement WP2/WP3; run local authenticated mock server including success and rejection; no outbound frames in this phase.
4. **Quality gate:** deterministic boundary/taxonomy tests; reviewer benchmark protocol; collect human review before any accuracy claim.
5. **Integration gate:** `npm run lint`, `npm test`, `npm run build`, schema/reference/CSV audit, package smoke for every supported target.
6. **Provider gate:** only after the OpenCode gateway permits access (or another explicitly authorized provider is configured), perform a capped live run with explicit consent. Record actual attempted calls, per-shot results, model/date, provider errors and transmission uncertainty. Stop immediately on non-retryable rejection.
7. **Release gate:** coordinator reviews all worker changes and the full diff; no critical/high findings, no unresolved platform claim, no missing reviewed-quality caveat. Do not stage/commit/push until the owner explicitly approves the final diff.

## Current gate status

- [x] Existing confidence serialization and matcher-precision tests present in working diff.
- [x] Cut candidate metadata, provider outcome/accounting, auth requirements, redirect rejection, embedded 403 classification present in working diff.
- [x] Latest full verification after Codex adapter work: 221 tests passed and one env-gated real-media test skipped by default; `npm run lint`, `npm run build`, and scoped `git diff --check` passed. The real-media test separately passed against the pinned Linux x64 archive using a local fetch fixture.
- [x] Added standalone deterministic `runCraftAnalysis` orchestration/report integration tests with fake FFmpeg/FFprobe processes and authenticated loopback OpenCode mock: success and embedded-403 partial-abort cases; exact call counts, schema/references, manifest/CSV and sentinel non-persistence checked. These tests do **not** decode media, validate a real JPEG, exercise native binaries, or establish vision quality.
- [x] Hardened CLI binary installation with bounded downloads, safe ZIP/TAR member filtering, `.tar.xz` streaming, staged version validation, same-filesystem replacement, and local offline fixtures. These tests do not establish source integrity, source compatibility, packaged provisioning, or Windows-native replacement behavior.
- [x] Added a compiled CLI process-level `analyze` integration test with fake FFmpeg/FFprobe and authenticated loopback OpenCode mock; checks explicit-consent vs no-consent request counts, JSON report, schema/references, artifacts, and sentinel non-persistence. Mock fixtures do not decode real media or establish provider quality.
- [x] Added CLI/desktop package-smoke assertions for FFprobe execution/probing and packaged OpenCode versions/architectures. The probe fixture uses rawvideo/NUT to avoid depending on optional H.264 encoders. A cleanly provisioned Linux x64 AppImage and CLI setup package passed the smoke locally, including packaged OpenCode auth, FFprobe probing, desktop startup, and playable MP3 conversion. Other native targets remain untested.
- [x] Added a benchmark protocol/template. Accuracy remains unverified; no licensed/human-reviewed benchmark has been collected.
- [x] Added pinned AV archive sources and SHA-256 verification for Windows x64, Linux x64/arm64, and macOS x64/arm64; package setup stages/validates the pair, builds universal macOS slices, and rolls back on replacement failure. Runtime CLI setup shares pinned sources and has offline checksum/size/pair tests. A separate real Linux x64 archive smoke verified runtime installer hash/one-download pair extraction, package setup's cached TAR extraction, version match, synthetic media probe, JPEG frame extraction, and compiled CLI reporting through an authenticated local mock. This does not verify other native targets or release packages.
- [x] Coordinator independently fetched GitHub Release API digests for pinned Windows/Linux assets, macOS SHA-256 sidecars, and macOS `versions.txt`; reported hashes/configurations matched the manifest. This metadata-only check was later supplemented by real Linux x64 archive/runtime verification; other platform archives remain unexecuted.
- [x] Linux x64 archive checksum, FFmpeg/FFprobe version match, generated-fixture probe, in-memory JPEG extraction, and compiled CLI/local-mock smoke passed on the current host. `-vsync 0` was incompatible with FFmpeg 9 and was replaced by `-fps_mode passthrough` after reproducing the failure with the pinned binary.
- [x] Added Codex CLI app-server provider support for image-capable model discovery, ephemeral/read-only turns, in-memory image data URLs, response schema validation, request accounting, and desktop model selection. Mock protocol tests pass; Codex model catalog discovery succeeds locally without inference.
- [x] Initial authorized 3-call Codex smoke returned 0 labels and `network-error`; investigation found the wrong `turn/start.sandboxPolicy` shape. After fixing it, a separately authorized one-call smoke returned a label. The pre-fix artifact's onward-transmission `false` is invalid; transmission remains unknown.
- [ ] Independently verify archive members/architectures and package smoke on Windows, Linux arm64, Intel macOS, and Apple Silicon; review GPL redistribution/source obligations. Linux x64 package/runtime smoke has passed; no other native package gate has passed.
- [x] Added managed OpenCode runtime lifecycle tests with a controlled local auth server: unauthenticated rejection, authenticated `/provider` success, awaited/idempotent shutdown, startup failure/timeout, forced termination, and isolated-root cleanup. This does **not** prove the bundled OpenCode server enforces auth.
- [x] Added a packaged OpenCode server-auth smoke to `scripts/package-smoke.mjs` (no inference request). It passed as part of the clean Linux x64 AppImage package smoke; other native targets remain untested.
- [ ] Run packaged auth smoke on Windows, Linux arm64, and macOS (Intel/Apple Silicon) and verify actual listener rejection, process termination, and data cleanup there; CLI external-server identity/auth remains externally controlled.
- [ ] Human-reviewed, rights-cleared quality benchmark and reproducible taxonomy baseline (exact taxonomy version, anchor, matched label, and matcher path).
- [x] Authorized corrected Codex integration smoke returned one model response and one labeled shot under a one-call cap; schema/references and non-persistence checks passed. This is not evidence of analysis accuracy or reliable access/quota. Do not retry OpenCode to evade its 403 block.
- [ ] Final full-diff review and owner approval.

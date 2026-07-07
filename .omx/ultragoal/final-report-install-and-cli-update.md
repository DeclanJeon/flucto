# Final Report: Install Utilities and CLI GitHub Update

## Outcome

Implemented Flucto install/setup reliability and CLI GitHub update support based on:

- `.omx/plans/flucto-install-and-cli-update-design.md`
- `.omx/plans/flucto-install-and-cli-update-work-order.md`
- `.omx/ultragoal/brief.md`

## Implemented

### Managed utility setup

- Added `src/main/services/binaryInstaller.ts`.
- Added `flucto setup` CLI command.
- `flucto setup --check-only` validates target setup paths without downloading or creating directories.
- `flucto setup --force` redownloads managed binaries only; explicit/env binary overrides are validation-only and are never overwritten.
- `flucto doctor --json` now includes actionable `fix` guidance when invalid.
- CLI binary resolution now defaults to Flucto managed bin dir while preserving explicit/env/bin-dir overrides.

### CLI GitHub update support

- Added `src/main/services/githubRelease.ts` for GitHub release parsing/fetching.
- Added `src/main/services/platformAssets.ts` for platform/arch asset selection and install-mode detection.
- Added `src/main/services/cliUpdater.ts` for update check/download/apply orchestration.
- Added CLI commands:
  - `flucto update check --json`
  - `flucto update download --output-dir DIR --json`
  - `flucto update apply --asset PATH --json`
- `update apply` is conservative and non-mutating for unsupported install modes.
- `update --json` failure paths return structured JSON from the update command handler.
- Downloads fail closed when a checksum manifest is present but cannot be fetched, omits the selected asset, or mismatches the downloaded file.

### Desktop missing-binary repair

- Desktop startup now attempts managed binary repair before showing the missing-component exit dialog.
- `getBinaryPath()` now skips non-executable candidates and can fall through to a repaired managed binary.
- Desktop app updates remain on `electron-updater` through `initializeAutoUpdater()`.

### Release metadata and docs

- `.github/workflows/release.yml` now generates `release/checksums-sha256.txt`.
- `.releaserc.json` publishes the checksum manifest as a GitHub release asset.
- `README.md` documents `flucto setup`, `flucto update`, managed bin dirs, resolution order, and conservative apply behavior.

## Changed Files

### Implementation

- `src/main/services/binaryInstaller.ts`
- `src/main/services/githubRelease.ts`
- `src/main/services/platformAssets.ts`
- `src/main/services/cliUpdater.ts`
- `src/cli/args.ts`
- `src/cli/index.ts`
- `src/cli/output.ts`
- `src/main/utils.ts`
- `src/main/index.ts`

### Tests

- `tests/cli.test.mjs`

### Release/docs/planning

- `.github/workflows/release.yml`
- `.releaserc.json`
- `README.md`
- `.omx/plans/flucto-install-and-cli-update-design.md`
- `.omx/plans/flucto-install-and-cli-update-work-order.md`
- `.omx/ultragoal/brief.md`
- `.omx/ultragoal/goals.json`
- `.omx/ultragoal/ledger.jsonl`
- `.omx/ultragoal/quality-gate-install-and-cli-update.json`
- `.omx/ultragoal/final-report-install-and-cli-update.md`

## Verification Evidence

Final verification after blocker fixes:

```text
npm test
# pass: 30 tests, 0 failures

npm run lint
# pass

npm run build
# pass: renderer build + electron TypeScript build

node dist-electron/cli/index.js setup --check-only --bin-dir ./bin --json
# valid: true, missing: []

node dist-electron/cli/index.js doctor --json
# valid: true, missing: []

node dist-electron/cli/index.js update check --json
# currentVersion: 1.9.1, latestVersion: 1.9.1, updateAvailable: false, recommendedAsset: Flucto-1.9.1-x86_64.AppImage
```

## Cleanup Gate

AI slop cleanup pass scope: changed files only.

Findings and actions:

- `setupUtilities --check-only` initially created the target bin directory; fixed so check-only remains non-provisioning.
- Removed a dead import after setup validity logic changed.
- Fallback-like/manual paths were reviewed:
  - unsupported `update apply` returns explicit manual instructions and does not mutate files;
  - checksum verification fails closed;
  - update JSON errors remain machine-readable.

Post-cleanup verification passed.

## Independent Review Gate

Initial independent review found blockers:

1. `setup --force` could overwrite explicit/env binary paths.
2. Checksum manifest availability did not force verification success.
3. `update check --json` emitted no JSON on API failures.
4. Desktop repair could be shadowed by non-executable bundled binaries.

All blockers were fixed and regression-tested.

Re-review results:

- `CodeReviewFixGate`: `APPROVE`, no CRITICAL/HIGH/MEDIUM/LOW findings.
- `ArchitectFixGate`: `CLEAR`, no findings.

## Architecture Invariant Proof

- CLI/services import boundary: grep found no `electron` or `electron-updater` imports in `src/main/services/*.ts` or `src/cli/*.ts`.
- Desktop updater boundary: `src/main/index.ts` still calls `initializeAutoUpdater()`; CLI update service is separate.
- Managed binary boundary: provisioning writes only to managed `binDir` unless explicit/env paths are only validated.
- JSON stdout boundary: update command catches update-service errors and writes JSON when `--json` is set.
- Checksum boundary: manifest presence now requires successful selected-asset verification.
- Non-mutating apply boundary: unsupported update apply returns `applied:false` and instructions.

## Known Limits

- `flucto update apply` remains intentionally conservative and does not auto-replace packaged installers/AppImages/deb installs.
- Existing latest release `v1.9.1` does not yet include `checksums-sha256.txt`; checksum verification applies to releases created after this workflow change.
- `scripts/setup-binaries.mjs` remains the npm lifecycle script; the TypeScript setup service is now the runtime CLI/desktop repair path.

## Commit and Push

Pending at report-write time. Final chat response will include the commit and push result.

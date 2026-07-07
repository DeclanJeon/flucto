# Work Order: Flucto Install Utilities and CLI GitHub Update

## Objective

Implement the install/setup/update design in `.omx/plans/flucto-install-and-cli-update-design.md` without changing Flucto's Electron + TypeScript stack.

## Non-goals

- Do not replace `electron-updater` for desktop app updates.
- Do not install `yt-dlp` or `ffmpeg` through system package managers by default.
- Do not add a new CLI parsing framework.
- Do not publish a release unless the existing release workflow is intentionally triggered by push/semantic-release.
- Do not commit unrelated generated live-test outputs or old YouTube-to-MD artifacts.

## Work Items

### W001 — Shared binary setup service

Target files:

- `src/main/services/binaryInstaller.ts`
- `src/main/services/binaryResolver.ts`
- `scripts/setup-binaries.mjs`

Tasks:

1. Add an Electron-free TypeScript service that can:
   - compute a managed user bin dir,
   - check `yt-dlp`/`ffmpeg`,
   - provision missing binaries,
   - force re-download,
   - check only without downloading,
   - return structured results.
2. Preserve explicit path/env/bin-dir precedence.
3. Keep `scripts/setup-binaries.mjs` compatible with `npm install`; it may remain a standalone JS implementation, but behavior and download sources must stay aligned.

Acceptance:

- `flucto setup --json` reports structured setup results.
- `flucto setup --check-only --bin-dir ./bin --json` succeeds when bundled binaries exist.
- Missing binaries produce actionable guidance.

### W002 — CLI setup and doctor wiring

Target files:

- `src/cli/args.ts`
- `src/cli/index.ts`
- `src/cli/output.ts`
- `tests/cli.test.mjs`

Tasks:

1. Add `setup` command.
2. Extend `doctor` JSON/human output with `fix` guidance when invalid.
3. Ensure JSON stdout remains valid JSON.
4. Keep human status/progress out of stdout when `--json` is used.

Acceptance:

- CLI args tests cover `setup --check-only`, `setup --force`, and `setup --bin-dir`.
- CLI smoke after build returns valid JSON for setup/doctor.

### W003 — CLI GitHub release update service

Target files:

- `src/main/services/githubRelease.ts`
- `src/main/services/platformAssets.ts`
- `src/main/services/cliUpdater.ts`
- `src/cli/args.ts`
- `src/cli/index.ts`
- `tests/cli.test.mjs`

Tasks:

1. Add GitHub latest-release fetcher.
2. Add semver-ish comparison that handles `v1.2.3` tags.
3. Add platform asset selection.
4. Add checksum manifest parsing and verification.
5. Add update commands:
   - `update check`
   - `update download`
   - `update apply`
6. Make `apply` conservative and non-mutating for unsupported install modes.

Acceptance:

- Tests cover release parsing, update availability, asset selection, checksum parsing, and unsupported apply response.
- `flucto update check --json` works against GitHub releases or returns a structured network/rate-limit error.

### W004 — Desktop missing-binary repair

Target files:

- `src/main/index.ts`
- `src/main/utils.ts` if needed
- `src/main/services/binaryInstaller.ts`

Tasks:

1. Before quitting on missing utilities, attempt repair into managed user bin dir.
2. Keep bundled/resource binary behavior intact.
3. If repair fails, preserve clear error dialog.

Acceptance:

- Typecheck passes.
- Desktop startup still creates window when health is valid.
- Repair path cannot import renderer or CLI modules.

### W005 — Release metadata hardening

Target files:

- `.github/workflows/release.yml`
- `.releaserc.json`

Tasks:

1. Generate `checksums-sha256.txt` for release assets.
2. Publish checksum manifest as a GitHub release asset.

Acceptance:

- Release workflow YAML remains valid enough for static review.
- `.releaserc.json` includes checksum asset.

### W006 — Documentation and report

Target files:

- `README.md`
- `.omx/ultragoal/final-report-install-and-cli-update.md`

Tasks:

1. Document `flucto setup`.
2. Document `flucto update check/download/apply`.
3. Document managed binary directory policy.
4. Write final implementation report with verification evidence.

Acceptance:

- README includes exact commands and failure-mode guidance.
- Final report includes changed files, verification commands, known limitations, commit hash, and push result.

## Required Verification

Run, in order:

```bash
npm test
npm run lint
npm run build
node dist-electron/cli/index.js --help
node dist-electron/cli/index.js setup --check-only --bin-dir ./bin --json
node dist-electron/cli/index.js doctor --json
node dist-electron/cli/index.js update check --json
```

If any command fails, fix source cause and repeat the affected verification path.

## Review Gate

Before commit:

1. Run cleanup/slop review on changed files only.
2. Run independent code review and architecture review.
3. Prove the architecture invariants from `.omx/ultragoal/brief.md`.

## Commit and Push

Commit only intended files. Use Lore commit protocol. Push to `origin/master`.

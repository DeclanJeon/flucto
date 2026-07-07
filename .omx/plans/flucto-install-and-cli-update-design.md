# Flucto Install Utilities and CLI GitHub Update Design

## Goal

Make Flucto reliable when installed as either a desktop app or a CLI-only tool:

1. Required utilities (`yt-dlp`, `ffmpeg`) are discovered, validated, and automatically provisioned when missing.
2. CLI-only installation gets the same utility preparation guarantees as desktop/development installs.
3. CLI users can check, download, and apply Flucto updates from GitHub releases without launching Electron.

## Current Evidence

### Existing binary setup

- `package.json:49` runs `node scripts/setup-binaries.mjs` on `postinstall`.
- `scripts/setup-binaries.mjs:7` writes binaries into `process.cwd()/bin`.
- `scripts/setup-binaries.mjs:61-80` downloads `yt-dlp` and `ffmpeg` only when the local `bin` target is missing.
- The setup script does not inspect system PATH before downloading local binaries.
- The setup script does not use `apt`, `brew`, `winget`, `choco`, or any system package manager.

### Desktop packaged app behavior

- `electron-builder.json5:19-25` bundles local `bin/**` as `extraResources`.
- `src/main/index.ts:181-198` checks binary health on app startup.
- `src/main/index.ts:186-198` shows an error and quits if required binaries are missing.
- `src/main/utils.ts:6-24` resolves binaries from packaged app resource paths.
- `src/main/utils.ts:30-45` checks only existence/executability; it does not auto-repair.

### CLI behavior

- `package.json:19-21` exposes `flucto` as a `bin` entry.
- `src/main/services/binaryResolver.ts:72-90` resolves CLI binaries from explicit paths, env vars, local `bin`, module-relative `bin`, and PATH.
- `src/cli/index.ts:50-72` implements `doctor`, which verifies binaries and versions but does not install or update them.
- `src/cli/args.ts:4-13` currently has no `setup`, `update`, or `self-update` command.

### Existing desktop updater

- `src/main/updater.ts:190-226` uses `electron-updater` for packaged desktop app updates.
- It skips update checks in development mode.
- It is Electron-specific and not reusable by CLI because it imports `electron` and `electron-updater`.

### Release source

- `.releaserc.json` publishes GitHub release assets: Windows installer/portable, macOS dmg/zip, Linux AppImage/deb.
- `.github/workflows/release.yml:143-209` collects built assets and runs semantic-release against GitHub releases.

## Requirements

### Functional requirements

1. `flucto doctor` reports utility health and versions.
2. `flucto setup` provisions missing utilities into a Flucto-managed binary directory.
3. `flucto setup --force` re-downloads managed utilities even if present.
4. `flucto setup --check-only` exits non-zero when required utilities are missing or non-executable.
5. Desktop startup can optionally auto-repair missing managed binaries before quitting.
6. CLI media/transcript commands can either:
   - fail fast with an actionable setup message, or
   - run setup automatically when missing binaries are managed by Flucto.
7. `flucto update check` checks GitHub releases for a newer Flucto version.
8. `flucto update download` downloads the correct release asset for the current platform/arch.
9. `flucto update apply` applies updates where a safe in-place strategy exists.
10. `flucto update` should be scriptable with `--json` and should avoid interactive prompts unless explicitly requested.

### Non-functional requirements

1. Do not require root/admin privileges for CLI utility setup.
2. Do not install global/system packages by default.
3. Keep Electron-only updater code out of the CLI import graph.
4. Preserve explicit binary override behavior: `--bin-dir`, `--yt-dlp`, `--ffmpeg`, `FLUCTO_YT_DLP_PATH`, `FLUCTO_FFMPEG_PATH`.
5. Updates must verify downloaded asset integrity where GitHub provides or we publish checksum metadata.
6. Failure messages must tell users which command fixes the problem.

## Architectural Decision

### Decision

Implement a shared Electron-free install/update service layer, then expose it through both CLI commands and desktop adapters.

Core modules:

```text
src/main/services/binaryInstaller.ts
src/main/services/githubRelease.ts
src/main/services/cliUpdater.ts
src/main/services/platformAssets.ts
```

CLI commands:

```text
flucto setup [--force] [--check-only] [--bin-dir DIR] [--json]
flucto doctor [--json]
flucto update check [--json]
flucto update download [--output-dir DIR] [--json]
flucto update apply [--asset PATH] [--json]
flucto update --json        # alias for check + download guidance, not silent apply
```

Desktop adapters:

- Keep `electron-updater` for desktop self-update.
- Use shared `binaryInstaller.ts` only for binary repair/check.
- Do not replace `electron-updater` with CLI updater for desktop app updates.

## Design Principles

1. **Managed local binaries first:** Flucto should own a predictable binary directory it can repair without admin privileges.
2. **System binaries are allowed but not mutated:** PATH-installed `yt-dlp`/`ffmpeg` can be used by CLI resolution, but setup should not modify system packages by default.
3. **CLI import graph stays Electron-free:** update/setup services must not import `electron`, `electron-updater`, or desktop logger/config modules.
4. **Explicit beats automatic:** user-provided `--yt-dlp`, `--ffmpeg`, env paths, and `--bin-dir` remain authoritative.
5. **Safe update semantics:** checking/downloading is safe; applying must be explicit and platform-aware.

## Proposed Files and Responsibilities

### `src/main/services/binaryInstaller.ts`

Electron-free replacement/generalization of `scripts/setup-binaries.mjs`.

Responsibilities:

- Describe required utilities:
  - name
  - executable filename per OS
  - download URL per OS/arch
  - version command
  - extraction strategy
- Check install targets.
- Download missing utilities.
- Extract archives.
- Set executable bits on Unix.
- Verify post-download executability.
- Return structured results for CLI JSON and desktop UI.

Types:

```ts
export interface UtilitySpec {
  name: 'yt-dlp' | 'ffmpeg';
  executableName: string;
  source: UtilityDownloadSource;
  versionArgs: string[];
}

export interface UtilitySetupOptions {
  binDir?: string;
  force?: boolean;
  checkOnly?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface UtilitySetupResult {
  valid: boolean;
  binDir: string;
  utilities: Array<{
    name: string;
    path: string;
    status: 'present' | 'downloaded' | 'missing' | 'failed';
    version?: string | null;
    error?: string;
  }>;
}
```

### `scripts/setup-binaries.mjs`

Keep this script for npm lifecycle compatibility, but make it a thin wrapper around the built or source installer logic.

Recommended path:

- Short term: keep JS script but align behavior with `binaryInstaller.ts`.
- Long term: build a small standalone setup script from TypeScript or move shared logic to plain ESM that both script and app can import.

### `src/main/services/githubRelease.ts`

Electron-free GitHub release client.

Responsibilities:

- Fetch latest release from:

```text
https://api.github.com/repos/DeclanJeon/flucto/releases/latest
```

- Parse tag, name, body, published date, assets.
- Compare semantic versions against current package version.
- Support GitHub API rate-limit errors and unauthenticated fallback.

Types:

```ts
export interface GitHubReleaseAsset {
  name: string;
  url: string;
  size: number;
  contentType: string;
}

export interface GitHubReleaseInfo {
  tagName: string;
  version: string;
  url: string;
  publishedAt: string;
  assets: GitHubReleaseAsset[];
}
```

### `src/main/services/platformAssets.ts`

Map current platform/arch/install mode to release asset.

Examples:

| Platform | Arch | Preferred asset |
| --- | --- | --- |
| Windows | x64 | `Flucto-<version>-x64-setup.exe` or portable exe |
| macOS | arm64 | `Flucto-<version>-arm64.zip` for CLI extract, `.dmg` for desktop/manual |
| macOS | x64 | `Flucto-<version>-x64.zip` |
| Linux | x64 | `.AppImage` for standalone, `.deb` for Debian installs |

The CLI must distinguish:

1. Running from npm/git checkout.
2. Running from packaged Electron resources.
3. Running from an extracted portable release.
4. Running from AppImage/deb-installed desktop package.

### `src/main/services/cliUpdater.ts`

CLI update orchestration.

Responsibilities:

- `checkForCliUpdate(currentVersion)`
- `downloadCliUpdate(asset, outputDir)`
- `applyCliUpdate(downloadedAsset, installMode)` where safe
- return structured status for JSON output.

Important: `apply` support should be conservative.

Initial supported actions:

- `check`: all installs.
- `download`: all installs.
- `apply`: only self-contained portable/extracted CLI installs where replacement is safe.
- `manual`: for `.dmg`, `.deb`, installer exe, AppImage if automatic replacement is unsafe.

## CLI UX Design

### Setup utilities

```bash
flucto setup --json
```

Success JSON:

```json
{
  "valid": true,
  "binDir": "/home/user/.local/share/flucto/bin",
  "utilities": [
    { "name": "yt-dlp", "status": "present", "version": "2026.06.09" },
    { "name": "ffmpeg", "status": "downloaded", "version": "7.0.2-static" }
  ]
}
```

Check-only failure:

```bash
flucto setup --check-only --json
```

```json
{
  "valid": false,
  "missing": ["ffmpeg"],
  "fix": "Run `flucto setup` or pass --ffmpeg PATH."
}
```

### Doctor

Keep `doctor`, but extend it to include setup guidance:

```bash
flucto doctor --json
```

If missing:

```json
{
  "valid": false,
  "missing": ["yt-dlp"],
  "fix": "Run `flucto setup` to install managed binaries."
}
```

### Update check

```bash
flucto update check --json
```

```json
{
  "currentVersion": "1.9.1",
  "latestVersion": "1.9.2",
  "updateAvailable": true,
  "releaseUrl": "https://github.com/DeclanJeon/flucto/releases/tag/v1.9.2",
  "recommendedAsset": "Flucto-1.9.2-x86_64.AppImage"
}
```

### Update download

```bash
flucto update download --output-dir ~/Downloads --json
```

```json
{
  "downloaded": true,
  "asset": "Flucto-1.9.2-x86_64.AppImage",
  "path": "/home/user/Downloads/Flucto-1.9.2-x86_64.AppImage",
  "next": "Run the downloaded AppImage or install the package manually."
}
```

### Update apply

```bash
flucto update apply --asset ~/Downloads/Flucto-1.9.2-x86_64.AppImage --json
```

If unsupported:

```json
{
  "applied": false,
  "reason": "Automatic apply is not supported for deb-installed Flucto.",
  "next": "Install the downloaded .deb with your package manager."
}
```

## Install Directory Policy

Recommended managed binary directory:

```text
~/.local/share/flucto/bin          # Linux
~/Library/Application Support/Flucto/bin  # macOS
%LOCALAPPDATA%\Flucto\bin          # Windows
```

But preserve compatibility with current local `bin/` behavior:

Resolution order should become:

1. Explicit CLI paths: `--yt-dlp`, `--ffmpeg`
2. Env paths: `FLUCTO_YT_DLP_PATH`, `FLUCTO_FFMPEG_PATH`
3. Explicit `--bin-dir`
4. Flucto managed user bin dir
5. Package-local `bin/`
6. Module-relative `bin/`
7. System PATH

Rationale:

- Managed user dir survives package reinstall better than package-local `bin`.
- Package-local `bin` preserves existing development/package behavior.
- PATH remains a valid fallback but not the primary managed target.

## Desktop Integration

### Startup behavior

Current behavior: missing binary -> error dialog -> quit.

Proposed behavior:

1. Run health check.
2. If missing and app is online, attempt managed binary repair.
3. If repair succeeds, continue startup.
4. If repair fails, show error dialog with details and manual instructions.

Pseudo-flow:

```ts
const health = await checkSystemHealth();
if (!health.valid) {
  const repair = await setupUtilities({ binDir: getDesktopManagedBinDir() });
  if (!repair.valid) {
    showMissingUtilitiesDialog(repair);
    app.quit();
    return;
  }
}
```

Important: desktop should still prefer bundled binaries inside `process.resourcesPath` for release determinism, but can repair into managed user bin when bundled binaries are missing or non-executable.

## Release Workflow Changes

### Continue publishing desktop assets

Keep existing semantic-release GitHub assets:

- Windows installer
- Windows portable
- macOS dmg
- macOS zip
- Linux AppImage
- Linux deb

### Add checksum asset

Add a generated checksum manifest:

```text
checksums-sha256.txt
```

The CLI updater can verify downloads against this file.

Release workflow step:

```bash
sha256sum release/* > release/checksums-sha256.txt
```

Then add to `.releaserc.json` GitHub assets.

### Optional CLI-specific archive

If CLI-only installation is a real distribution target, add platform-specific CLI archives:

```text
flucto-cli-linux-x64.tar.gz
flucto-cli-macos-arm64.tar.gz
flucto-cli-macos-x64.tar.gz
flucto-cli-win-x64.zip
```

Each should include:

- `dist-electron/cli/index.js`
- required service/shared JS modules
- `package.json`
- `bin/yt-dlp`
- `bin/ffmpeg`
- launcher script/shim

This makes CLI-only update much safer than trying to extract CLI pieces out of Electron app packages.

## Implementation Steps

### Phase 1 — Utility setup service

1. Create `src/main/services/binaryInstaller.ts`.
2. Move URL/extract/check/version logic from `scripts/setup-binaries.mjs` into reusable functions.
3. Keep `scripts/setup-binaries.mjs` as wrapper or duplicate-compatible minimal fallback.
4. Add CLI command `setup` in `src/cli/args.ts` and `src/cli/index.ts`.
5. Extend `doctor` output with setup guidance.
6. Add tests for:
   - present binaries
   - missing binaries
   - `--check-only`
   - explicit `--bin-dir`
   - env path overrides

### Phase 2 — Runtime missing-binary behavior

1. Add `ensureBinaries` helper for CLI commands.
2. For `download`, `info`, `formats`, `languages`, `transcript`, and `batch`, fail with actionable setup guidance if binaries are missing.
3. Optional: add `--auto-setup` to allow commands to provision missing managed binaries before executing.
4. Add desktop adapter to attempt repair before startup quit.
5. Add tests for CLI command behavior when binaries are missing.

### Phase 3 — GitHub release update service

1. Create `src/main/services/githubRelease.ts`.
2. Create `src/main/services/platformAssets.ts`.
3. Create `src/main/services/cliUpdater.ts`.
4. Add CLI commands:
   - `update check`
   - `update download`
   - `update apply`
5. Add tests using fixture GitHub release JSON.
6. Add network integration smoke gated behind an opt-in env var, e.g. `FLUCTO_LIVE_UPDATE_TEST=1`.

### Phase 4 — Release metadata hardening

1. Add checksum generation to `.github/workflows/release.yml`.
2. Add checksum asset to `.releaserc.json`.
3. Decide whether to publish dedicated CLI archives.
4. If yes, add build script and release assets for CLI archives.

### Phase 5 — Documentation

1. Update README CLI section:
   - `flucto setup`
   - `flucto update check/download/apply`
   - binary directory policy
   - system vs managed binaries
2. Add troubleshooting:
   - `--ignore-scripts`
   - offline install
   - GitHub API rate limits
   - unsupported automatic apply cases

## Acceptance Criteria

### Utility setup acceptance

- `flucto setup --json` downloads missing `yt-dlp` and `ffmpeg` into the managed bin dir and exits `0`.
- `flucto setup --check-only --json` exits non-zero and returns missing utilities without downloading.
- `flucto doctor --json` reports versions when utilities exist.
- If utilities are missing, `flucto doctor --json` includes a `fix` field.
- Existing `npm install` still prepares binaries through `postinstall`.
- Existing desktop packaged builds still include `bin/**` as extra resources.

### CLI update acceptance

- `flucto update check --json` returns current version, latest version, update availability, release URL, and recommended asset.
- `flucto update download --json` downloads the recommended GitHub release asset to the requested output directory.
- Downloaded asset checksum is verified when checksum metadata is available.
- `flucto update apply --json` never silently mutates unsupported install types; it returns manual instructions.
- CLI update code imports no Electron modules.

### Desktop acceptance

- Packaged app still uses `electron-updater` for app updates.
- Missing bundled utilities trigger one repair attempt before final error/quit.
- Repair failure produces a user-readable error with exact missing utility names.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| GitHub API rate limits | CLI update check fails | Use unauthenticated API with clear rate-limit error; support `GITHUB_TOKEN` env for higher limits |
| Download tampering/corruption | Unsafe update install | Publish and verify SHA256 checksums |
| Auto-applying installer assets is unsafe | Broken installs | Make `apply` conservative; prefer download + manual instructions unless install mode is known safe |
| `postinstall` skipped with `--ignore-scripts` | Missing binaries after CLI install | `doctor` and media commands return `flucto setup` guidance |
| System package manager differences | Unreliable install | Do not mutate system packages by default; use managed local bin |
| Desktop and CLI binary resolution diverge | Different user behavior | Share `binaryInstaller` and eventually unify resolver policy |

## Open Decisions

1. Should CLI-only distribution become an official release artifact?
   - Recommendation: yes, if CLI is a supported first-class installation mode.
2. Should media commands auto-run setup by default when binaries are missing?
   - Recommendation: no by default; add `--auto-setup` or config opt-in.
3. Should desktop repair download into bundled resources or user managed dir?
   - Recommendation: user managed dir, because installed app resources may be read-only.
4. Should system package manager installation ever be attempted?
   - Recommendation: no for default behavior; document manual system install instead.

## Verification Plan

### Unit tests

- `binaryInstaller` URL selection per OS/arch.
- archive extraction behavior with fixtures.
- checksum parsing and verification.
- platform asset selection.
- semantic version comparison.
- CLI args for `setup` and `update` subcommands.

### Integration tests

- Missing temp bin dir -> `flucto setup --json` downloads or fixture-installs utilities.
- `flucto doctor --bin-dir temp --json` reports valid after setup.
- `flucto update check --json` against fixture release JSON reports update available.
- `flucto update download --json` downloads a fixture asset and verifies checksum.

### Live smoke tests

Opt-in only:

```bash
FLUCTO_LIVE_UPDATE_TEST=1 npm test
```

Scenarios:

- GitHub latest release read.
- Recommended asset selection for current OS/arch.
- Download to temp dir.
- Checksum verification.

## Recommended Next Step

Implement Phase 1 and Phase 2 first. They solve the installation reliability gap and make CLI-only usage self-healing enough. Then implement GitHub release update checks/downloads in Phase 3. Automatic `apply` should remain conservative until install modes are explicitly identified and tested.

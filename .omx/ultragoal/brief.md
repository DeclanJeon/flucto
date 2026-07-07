# Ultragoal Brief: Flucto CLI Mode

## Objective

Implement and release a first-class `flucto` CLI mode for AI-agent automation. Users must be able to run Flucto media download and transcript-to-Markdown workflows from a terminal without installing or launching the desktop app.

## Source Artifacts

- `.omx/plans/flucto-cli-mode-design.md`
- `.omx/plans/flucto-cli-mode-work-order.md`

## Scope

In scope:

- Electron-free service layer for downloader, metadata, formats, batch parsing, transcript conversion, settings defaults, and binary resolution.
- CLI entrypoint with commands: `download`, `batch`, `transcript`, `info`, `formats`, `languages`, `doctor`, `--help`, `--version`.
- Desktop IPC adapters updated to use shared services where required for parity.
- Tests and smoke verification for CLI and shared services.
- README/CHANGELOG/release notes updates.
- Commit, push, version/release workflow verification, and final report.

Out of scope unless required to satisfy tests:

- Publishing standalone CLI zip artifacts.
- Adding a new CLI parsing dependency.
- Changing media extraction backend away from yt-dlp/ffmpeg.
- Replacing Electron desktop UI.

## Architecture Invariants

1. CLI execution path must not import Electron runtime modules.
2. Desktop IPC and CLI must share service logic instead of duplicating downloader/transcript behavior.
3. Human progress must go to stderr; machine-readable final output must go to stdout.
4. Transcript `--stdout` must emit only Markdown to stdout.
5. CLI binary resolution must not depend on Electron app path APIs.
6. Existing desktop behavior must remain available through IPC handlers.
7. No new runtime dependency unless Node built-ins are insufficient and the tradeoff is documented.

## Quality Gates

- `npm run build` passes.
- `npm run lint` passes.
- `npm test` passes.
- `node dist-electron/cli/index.js --help` exits 0.
- `node dist-electron/cli/index.js doctor --json` exits 0 when local binaries are present.
- Independent code review returns approve/clear.
- Architecture invariant audit proves all invariants with implementation, tests, and review evidence.

## Release Gates

- Changes committed with Lore protocol.
- Push to `origin/master` succeeds.
- Version/release workflow is verified.
- Final report written to `.omx/ultragoal/final-report-cli-mode.md`.

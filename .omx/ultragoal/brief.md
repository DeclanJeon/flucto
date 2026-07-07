# Ultragoal Brief: Flucto Install Utilities and CLI GitHub Update

## User Request

Implement the design for reliable Flucto installation utilities and CLI GitHub update support. Preserve the current Electron/TypeScript stack. Use the design and work order as implementation authorities. Repeat QA and tests until the result is release-ready, then write a report, commit, and push.

## Source Design

- `.omx/plans/flucto-install-and-cli-update-design.md`

## Required Deliverables

1. Durable implementation work order under `.omx/plans/`.
2. Shared Electron-free service for checking/provisioning required utilities (`yt-dlp`, `ffmpeg`).
3. CLI setup command for managed utility provisioning.
4. CLI doctor guidance for missing utilities.
5. CLI GitHub release update commands:
   - `flucto update check`
   - `flucto update download`
   - `flucto update apply`
6. Conservative update-apply behavior: never silently mutate unsupported install types.
7. Release metadata hardened with checksum publishing support.
8. Desktop missing-binary startup repair path that does not replace `electron-updater`.
9. Focused tests and smoke checks for new CLI/service behavior.
10. Final report under `.omx/ultragoal/`.
11. Lore-protocol commit and push to `origin/master`.

## Constraints

- Do not change the application stack.
- Do not introduce a new runtime dependency unless Node built-ins are insufficient.
- Keep CLI import graph Electron-free.
- Preserve explicit binary override behavior:
  - `--bin-dir`
  - `--yt-dlp`
  - `--ffmpeg`
  - `FLUCTO_YT_DLP_PATH`
  - `FLUCTO_FFMPEG_PATH`
- Do not install global/system packages by default.
- Use Flucto-managed local binary directories for auto-provisioning.
- Keep desktop app updates on `electron-updater`.
- CLI update service may read GitHub releases directly, but automatic apply must be conservative.
- Do not include unrelated untracked artifacts in the commit.

## Architecture Invariants

1. CLI commands must not import Electron runtime modules or `electron-updater`.
2. Binary setup/update services must be Electron-free and reusable by CLI.
3. Desktop auto-update remains handled by `src/main/updater.ts` / `electron-updater`.
4. Utility provisioning must not mutate system package managers or require admin/root by default.
5. Explicit binary paths and env overrides must remain authoritative over managed paths.
6. Machine-readable CLI JSON must go to stdout; human progress/errors must not corrupt JSON stdout.
7. Release downloads must verify checksum metadata when available.
8. Unsupported update apply modes must return actionable manual instructions instead of mutating files.

## Verification Targets

- `npm test`
- `npm run lint`
- `npm run build`
- CLI smoke:
  - `node dist-electron/cli/index.js --help`
  - `node dist-electron/cli/index.js setup --check-only --bin-dir ./bin --json`
  - `node dist-electron/cli/index.js doctor --json`
  - `node dist-electron/cli/index.js update check --json`

## Completion Gate

Work is complete only after implementation, focused tests, build/lint/test verification, cleanup review, independent review, final report, commit, and push all succeed.

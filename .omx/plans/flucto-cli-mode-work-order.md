# Flucto CLI Mode Work Order

## Mission

Implement a first-class `flucto` CLI for AI-agent automation without changing Flucto's stack. The CLI must reuse the current TypeScript/Node yt-dlp/ffmpeg implementation through an Electron-free service layer, while the desktop app remains functional through thin Electron adapters.

## Source Design

- Design document: `.omx/plans/flucto-cli-mode-design.md`
- Current stack: Electron + TypeScript + Vite + yt-dlp/ffmpeg binaries from `scripts/setup-binaries.mjs`
- Current release version at start: `1.8.1`

## Non-negotiable Architecture Invariants

1. CLI execution path must not import Electron runtime modules.
2. Desktop IPC and CLI must share service logic instead of duplicating downloader/transcript behavior.
3. Human progress must go to stderr; machine-readable final output must go to stdout.
4. Transcript `--stdout` must emit only Markdown to stdout.
5. CLI binary resolution must not depend on `app.getPath`, `app.getAppPath`, `app.isPackaged`, or `process.resourcesPath`.
6. Existing desktop behavior must remain available through IPC handlers.
7. No new runtime dependency unless implementation proves Node built-ins are insufficient.

## Work Items

### W001 — Extract Electron-free foundations

Files:

- Add `src/main/services/settingsDefaults.ts`
- Add `src/main/services/binaryResolver.ts`
- Add `src/main/services/paths.ts` if needed
- Update `src/main/store.ts` to reuse extracted defaults/validators
- Keep desktop-specific `src/main/utils.ts#getBinaryPath` behavior intact

Acceptance:

- Pure defaults are importable without Electron.
- CLI binary resolver checks explicit flags/env/bin dir/local `bin`/PATH fallback.
- Desktop store still returns the same default download/transcript/update settings.

### W002 — Extract media service layer

Files:

- Add `src/main/services/mediaDownload.ts`
- Add `src/main/services/mediaInfo.ts`
- Add `src/main/services/batch.ts`
- Update `src/main/index.ts` handlers to call services where safe
- Keep `src/main/media/ytDlp.ts` as shared platform argument source

Acceptance:

- Download arg generation is shared between desktop and CLI.
- `download-single` behavior remains parity baseline.
- Info/formats/playlist logic is reusable outside IPC.
- Batch URL parser matches desktop behavior: ignore blank lines and lines beginning `#`, `;`, or `]`.

### W003 — Extract transcript service layer

Files:

- Add `src/main/services/transcriptMarkdown.ts`
- Update `src/main/transcript/transcriptHandlers.ts` into thin IPC adapter
- Adjust `src/main/transcript/captionExtractor.ts` only if binary resolver injection is required

Acceptance:

- Transcript conversion logic works without Electron IPC/WebContents.
- Desktop transcript progress/clipboard/history behavior remains available.
- CLI transcript conversion supports `--stdout`, `--output-dir`, language, timestamps, metadata toggles.

### W004 — Add CLI entrypoint

Files:

- Add `src/cli/index.ts`
- Add `src/cli/args.ts`
- Add `src/cli/output.ts`
- Update `tsconfig.electron.json` include
- Update `package.json` scripts and `bin` entry

Commands:

```bash
flucto download <url> --format mp4|mp3
flucto batch <file> --format mp4|mp3|md
flucto transcript <url> [--stdout] [--json]
flucto info <url> [--json]
flucto formats <url> [--json]
flucto languages <url> [--json]
flucto doctor [--json]
flucto --help
flucto --version
```

Acceptance:

- `node dist-electron/cli/index.js --help` exits 0.
- `node dist-electron/cli/index.js doctor --json` exits 0 when binaries exist.
- CLI never initializes Electron.

### W005 — Tests and QA

Files:

- Add tests under `tests/*.test.mjs`
- Prefer stub binaries/temp dirs for CLI service behavior
- Keep current `npm test` path working

Acceptance:

- Tests cover args parser, binary resolver, batch parser, progress parser, transcript service, and CLI help/doctor JSON.
- `npm run build`, `npm run lint`, and `npm test` pass.
- Independent review confirms architecture invariants.

### W006 — Release and report

Files:

- Update `CHANGELOG.md`
- Update `README.md` CLI usage after commands are verified
- Write `.omx/ultragoal/final-report-cli-mode.md`

Acceptance:

- Commit follows Lore protocol.
- Push to `origin/master` succeeds.
- Semantic-release creates the next version or a version bump commit is present according to project release flow.
- Final report includes changed files, commands run, test evidence, release evidence, and known gaps.

## Verification Commands

```bash
npm run build
npm run lint
npm test
node dist-electron/cli/index.js --help
node dist-electron/cli/index.js doctor --json
```

## Done Definition

The CLI mode is complete when:

1. Service layer exists and is shared by desktop + CLI.
2. CLI supports the command set above.
3. Desktop build/test/lint pass.
4. CLI smoke commands pass.
5. Architecture invariant audit passes.
6. Independent review approves.
7. Changes are committed, pushed, and released/versioned.
8. Final report is written.

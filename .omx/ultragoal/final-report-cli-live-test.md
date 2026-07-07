# Final Report: CLI Live Test and Patch Release

## Outcome

Ran live CLI tests against real network targets, deleted generated test artifacts, fixed one real download selector defect, and released the fix as `v1.9.1`.

- Latest release: `v1.9.1`
- Release URL: https://github.com/DeclanJeon/flucto/releases/tag/v1.9.1
- Fix commit: `696a8cf` — `fix(cli): fallback to generic mp4 formats`
- Release workflow: `28838659052` — success
- Package version after fast-forward: `1.9.1`

## Deleted Test Artifacts

The live test output directory was removed after verification:

```text
/tmp/flucto-cli-live-mr_5psgg
```

Deletion verification passed with:

```bash
test ! -e /tmp/flucto-cli-live-mr_5psgg
```

## Live CLI Tests Performed

### 1. Build current CLI

```bash
npm run build:electron
```

Result: passed.

### 2. Binary doctor

```bash
node dist-electron/cli/index.js doctor --json
```

Result: passed.

Observed binaries:

- `yt-dlp`: `/home/declan/Documents/Develop/Project/flucto/bin/yt-dlp`
- `ffmpeg`: `/home/declan/Documents/Develop/Project/flucto/bin/ffmpeg`
- `yt-dlp` version: `2026.06.09`
- `ffmpeg` version: `7.0.2-static`

### 3. Real YouTube metadata

```bash
node dist-electron/cli/index.js info https://www.youtube.com/watch?v=dQw4w9WgXcQ --json
```

Result: passed.

Observed metadata:

- id: `dQw4w9WgXcQ`
- title: `Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)`
- duration: `213`
- uploader: `Rick Astley`

### 4. Real YouTube formats

```bash
node dist-electron/cli/index.js formats https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

Result: passed.

Observed MP4 formats included `144p`, `360p`, `720p`, `1080p`, `1440p`, and `2160p` entries.

### 5. YouTube media download attempt

```bash
node dist-electron/cli/index.js download https://www.youtube.com/watch?v=dQw4w9WgXcQ \
  --format mp4 \
  --quality 360p \
  --output-dir /tmp/flucto-cli-live-mr_5psgg \
  --json \
  --progress-json
```

Result: expected external failure in this environment.

Observed error:

```text
HTTP Error 403: Forbidden
```

Interpretation: CLI returned structured JSON error correctly. The failure is specific to YouTube media data access in this environment; the same URL succeeded for metadata, formats, languages, and transcript conversion.

### 6. Generic direct MP4 download

Initial command:

```bash
node dist-electron/cli/index.js download https://samplelib.com/lib/preview/mp4/sample-5s.mp4 \
  --format mp4 \
  --output-dir /tmp/flucto-cli-live-mr_5psgg \
  --json \
  --progress-json
```

Initial result: failed.

Observed error:

```text
Requested format is not available
```

Root cause: the generic extractor exposed a single literal format id `mp4`, while the existing selector was tuned for YouTube-style `bestvideo+bestaudio` and codec-filtered MP4 formats.

Fix: added `mp4/best` fallback for normal MP4 selectors and `mp4/worst` fallback for worst selectors in both shared CLI service and remaining desktop inline selector.

Files changed:

- `src/main/services/mediaDownload.ts`
- `src/main/index.ts`
- `tests/cli.test.mjs`

Retest result: passed.

Generated file before cleanup:

```text
/tmp/flucto-cli-live-mr_5psgg/sample-5s.mp4
```

Observed size before cleanup:

```text
2,848,208 bytes
```

Container/decode verification passed:

```bash
bin/ffmpeg -v error -i /tmp/flucto-cli-live-mr_5psgg/sample-5s.mp4 -f null -
```

### 7. Real caption language listing

```bash
node dist-electron/cli/index.js languages https://www.youtube.com/watch?v=dQw4w9WgXcQ --json
```

Result: passed.

Observed languages included:

- `en` — English, manual caption
- `ja` — Japanese, manual caption
- `ko` — Korean, automatic caption
- many additional automatic caption languages

### 8. Real caption-to-Markdown conversion

```bash
node dist-electron/cli/index.js transcript https://www.youtube.com/watch?v=dQw4w9WgXcQ \
  --language en \
  --output-dir /tmp/flucto-cli-live-mr_5psgg \
  --json \
  --progress-json
```

Result: passed.

Observed final response:

- `success`: `true`
- `message`: `Markdown conversion complete.`
- `language`: `en`
- `segmentCount`: `61`
- `wordCount`: `519`

Generated Markdown file before cleanup:

```text
/tmp/flucto-cli-live-mr_5psgg/Rick_Astley_-_Never_Gonna_Give_You_Up_(Official_Vi_20260707.md
```

Observed size before cleanup:

```text
2,628 bytes
```

Markdown content checks passed:

- Title present
- Channel metadata present
- URL metadata present
- Timestamp headings present
- Expected lyric text present

## Regression Verification After Fix

After the selector fix, the following passed:

```bash
npm test
npm run lint
npm run build:electron
npm run build
```

Observed test result:

- 23 tests passed
- 0 failed

## Release Verification

Fix release passed:

- Workflow: `28838659052`
- Release: `v1.9.1`
- URL: https://github.com/DeclanJeon/flucto/releases/tag/v1.9.1
- `package.json`: `1.9.1`
- `CHANGELOG.md`: `1.9.1` entry for `fix(cli): fallback to generic mp4 formats`

## Repository State at Report Time

Tracked files are clean after release fast-forward. The only remaining untracked files are older YouTube-to-MD `.omx` artifacts not included in the CLI live test release:

```text
.omx/plans/youtube-to-md-integration-design.md
.omx/plans/youtube-to-md-work-order.md
.omx/ultragoal/final-report-youtube-to-md.md
.omx/ultragoal/quality-gate-youtube-to-md.json
```

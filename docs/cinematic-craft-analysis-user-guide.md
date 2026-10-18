# Reference-video analysis (early implementation)

## Desktop

1. Complete a taxonomy build first. For example:
   ```sh
   flucto craft build --skills /path/to/contents-production-skills -o ./craft
   ```
   `craft/` must contain `taxonomy.csv` and `build-manifest.json`.
2. Open the clapperboard button, select a local video or enter a supported HTTPS media URL, select the taxonomy folder and an output folder.
3. For a URL, confirm that you have permission to download it. The downloaded source is retained in the run's `source/` folder.
4. Optional: install Codex CLI and run `codex login` in a terminal. Open the CPU button, refresh the Codex model catalog, choose a model marked as image-capable, and save. Flucto stores only the selected model and optional CLI path; Codex credentials remain under Codex's own account storage. On each run, explicitly allow representative frames to be sent to Codex.
5. Start analysis. The run writes `analysis.json`, `manifest.json`, `shotlog.csv`, `shots.csv`, `scenes.csv`, `techniques.csv`, `technique_applications.csv`, `evidence.csv`, `production_plan.csv`, and `tool_recommendations.csv`.

Codex image support is taken from the local Codex CLI model catalog; it does not guarantee that a request will be accepted or that the user's subscription includes the required quota. The provider/model identity and incomplete outcomes are recorded. Flucto starts `codex app-server` per shot, sends image data URLs in memory, requests ephemeral threads, and uses a read-only temporary working directory. Flucto does not save credentials or frame files; Codex-side retention is governed by Codex policies. Codex CLI must be installed and authenticated by the user; Flucto does not bundle or provision it.

## CLI

Local file:

```sh
flucto analyze ./reference.mp4 --craft ./craft --json
```

When `-o` is omitted, analysis outputs default to the user's Documents/`flucto` folder (Linux uses the configured XDG Documents directory when available). Use `-o ./analyses` to override it.

Supported HTTPS URL (download permission is an explicit flag):

```sh
flucto analyze 'https://www.youtube.com/watch?v=VIDEO_ID' --allow-download --craft ./craft -o ./analyses --json
```

`--dry-run` on a URL downloads the source first, so only use it after explicitly allowing the download. Authenticate with Codex CLI using `codex login`, then configure CLI analysis with `FLUCTO_VISION_PROVIDER=codex-cli` and `FLUCTO_VISION_MODEL=<image-capable model>`. Set `FLUCTO_CODEX_PATH` if `codex` is not on PATH. Desktop model selection is stored locally and is not automatically shared with CLI.

Example CLI invocation (use a model listed as image-capable by your Codex account):

```sh
FLUCTO_VISION_PROVIDER=codex-cli FLUCTO_VISION_MODEL=gpt-6-luna \
  flucto analyze ./reference.mp4 --craft ./craft --allow-vision-api --max-api-calls 3 --json
```

The example model may not be available on every account. `--allow-vision-api` still requires explicit consent to send sampled frames.

## Data contract and current limits

- **Not release-ready yet:** `ffprobe` must be available beside the selected `ffmpeg`. Pinned sources cover Windows x64, Linux x64/arm64, and macOS x64/arm64. Cross-platform package validation passed on Windows, Linux, and macOS (macOS package smoke on Intel), while real-video FFmpeg/FFprobe analysis was exercised on Linux x64 only. GPL redistribution/source review remains open. Run `flucto doctor --json`; a successful build does not prove the analysis prerequisites are installed.
- **Codex integration is only minimally verified:** after correcting an app-server request shape, a one-call real-video smoke returned one label. This does not establish label accuracy, provider availability, or subscription quota. Codex onward transmission is not observable. OpenCode support was retired and is not shipped.
- `schemas/analysis-run.v1.schema.json` is the versioned contract for `analysis.json`; report tests validate it with Ajv.
- CSV is UTF-8 with BOM, CRLF, and RFC 4180 escaping. `analysis.json` is canonical; CSVs are exports for review and spreadsheet use.
- Video frames are never written as image files. Vision frames are downscaled and held in memory, then sent only after explicit consent.
- Scene-score boundaries remain `ESTIMATED`; no boundary is confirmed as a hard cut without two-sided verification. Luma is sampled at 2 Hz. Audio RMS uses coarse 48k-sample windows; neither is semantic scene/audio understanding.
- Current scene grouping is a weak adjacent-label heuristic. Review all scene IDs. Camera/subject movement, source equipment, original editor, and author intent cannot be reliably inferred from pixels alone.
- The plan currently provides shot-card, production, and edit tasks; it is a structured first pass, not a guaranteed shot-for-shot reconstruction. DaVinci Resolve is recommended for timeline editing based on its official feature page, not as a claim about the source workflow. Blender is only suggested when an estimated label explicitly indicates animation/CGI. Pricing/license remain `unknown` where not verified.
- No video-generation model is currently recommended. Codex models used here are for vision analysis; they are not presumed to generate video. A future generator recommendation requires a verified capability, access, version, licensing, and source catalog.

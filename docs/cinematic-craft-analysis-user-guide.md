# Reference-video analysis (early implementation)

## Desktop

1. Complete a taxonomy build first. For example:
   ```sh
   flucto craft build --skills /path/to/contents-production-skills -o ./craft
   ```
   `craft/` must contain `taxonomy.csv` and `build-manifest.json`.
2. Open the clapperboard button, select a local video or enter a supported HTTPS media URL, select the taxonomy folder and an output folder.
3. For a URL, confirm that you have permission to download it. The downloaded source is retained in the run's `source/` folder.
4. Optional: open the CPU button, refresh the OpenCode model catalog, choose an image-input model whose published input and output prices are both zero, enter the selected provider's API key, and save. Flucto stores the key only when OS keychain-backed Electron safeStorage is available. On each run, explicitly allow representative frames to be sent to that provider.
5. Start analysis. The run writes `analysis.json`, `manifest.json`, `shotlog.csv`, `shots.csv`, `scenes.csv`, `techniques.csv`, `technique_applications.csv`, `evidence.csv`, `production_plan.csv`, and `tool_recommendations.csv`.

The catalog's zero-price status is not a promise of free access: providers can require account credentials, rate-limit, change pricing, or reject requests. The provider/model identity and any incomplete output are recorded. The OpenCode local server listens only on loopback and uses a per-run Basic-auth secret; its home/config/data directories are isolated and removed on exit.

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

`--dry-run` on a URL downloads the source first, so only use it after explicitly allowing the download. Vision API configuration for CLI runs currently uses the existing `FLUCTO_VISION_*` environment contract; the desktop keychain/model picker is not automatically shared with CLI.

## Data contract and current limits

- `schemas/analysis-run.v1.schema.json` is the versioned contract for `analysis.json`; report tests validate it with Ajv.
- CSV is UTF-8 with BOM, CRLF, and RFC 4180 escaping. `analysis.json` is canonical; CSVs are exports for review and spreadsheet use.
- Video frames are never written as image files. Vision frames are downscaled and held in memory, then sent only after explicit consent.
- Scene-score boundaries remain `ESTIMATED`; no boundary is confirmed as a hard cut without two-sided verification. Luma is sampled at 2 Hz. Audio RMS uses coarse 48k-sample windows; neither is semantic scene/audio understanding.
- Current scene grouping is a weak adjacent-label heuristic. Review all scene IDs. Camera/subject movement, source equipment, original editor, and author intent cannot be reliably inferred from pixels alone.
- The plan currently provides shot-card, production, and edit tasks; it is a structured first pass, not a guaranteed shot-for-shot reconstruction. DaVinci Resolve is recommended for timeline editing based on its official feature page, not as a claim about the source workflow. Blender is only suggested when an estimated label explicitly indicates animation/CGI. Pricing/license remain `unknown` where not verified.
- No video-generation model is currently recommended. OpenCode's discovered zero-price image-input models are vision-analysis models; they are not presumed to generate video. A future generator recommendation requires a verified capability, access, version, licensing, and source catalog.

# yt-dlp startup stalls under constrained memory (2026-11-05)

## Observed cause and limits

The agent's command service had `memory.high=3 GiB`, `memory.max=4 GiB`, current usage about3.37GB and millions of high-limit events. Its cgroup memory-pressure counters showed substantial reclaim stalls, even though system-wide RAM appeared available. The old41MB PyInstaller yt-dlp unpacked a private runtime on each start; even `--version` timed out inside this service. The same original2026.10.29.232701 engine started successfully in a separate bounded user scope. This rules out treating the old binary as simply corrupt or the requested video as unavailable.

The official3MB Python zipapp2026.11.04.232659 started successfully, and using it with the existing Flucto CLI restored metadata lookup for the exact requested video. Updating the engine alone does not remove a service's cgroup pressure: one ordinary installed-CLI test inside the shared service still timed out. Shared service limits have NOT been changed. Live repository validation ran in a temporary1GiB/2GiB user scope so it did not compete with that3GiB high limit. These scopes are transient; no daemon or persistent resource policy was installed.

## Repository changes

- `src/main/spawn.ts`: opt-in bounded subprocesses, timeout results/errors, POSIX process-group termination and force-kill grace, Windows process-tree termination. Calls without a deadline retain their existing contract.
- `src/main/services/binaryInstaller.ts`:15-second version probes,15-second latest-version HTTP timeout, shared runtime source selection for both setup and binary refresh. Custom binaries are not overwritten; staged validation and atomic replacement remain in place.
- `src/main/services/ytDlpRuntimeSources.ts`: Linux runtime setup prefers the upstream Python zipapp only after a bounded Python>=3.10 capability probe. Native architecture-matched fallback remains. Other platforms, custom URLs and desktop packaging keep their original source policy; Python is not a new unconditional dependency.
- `src/cli/args.ts`: register the existing `--yt-dlp-only` setup flag. Its parsed value and setup implementation existed, but the option registry rejected it.
- `tests/yt-dlp-startup.test.mjs`: regression tests for deadlines, rejecting/success contracts, force kill, hung version validation, source policy/fallback, atomic preservation and setup parsing.

Existing working-tree edits in README/package/CLI/social-search work were preserved. No release, version bump, commit or publication was performed. The installed CLI package itself was not wholesale replaced from this dirty working tree; the rebuilt repository CLI was exercised directly and used to update the managed yt-dlp engine.

## Red/green proof

Before implementation, three timeout/version regressions failed: the stalled processes reported success or returned a late version. The setup-flag regression separately failed with `ERR_PARSE_ARGS_UNKNOWN_OPTION`. After implementation, the TypeScript Electron build and63 targeted tests passed (startup, refresh, architecture sources, installer security, archive checksums and CLI contracts).

```sh
npm run build:electron
node --test --test-concurrency=1 \
  tests/yt-dlp-startup.test.mjs tests/binaryRefresh.test.mjs \
  tests/binary-arch-sources.test.mjs tests/binary-installer-security.test.mjs \
  tests/binary-source-checksum.test.mjs tests/cli.test.mjs
```

For this particular constrained agent service, the build/tests/live CLI were launched with `systemd-run --user --scope --quiet --property=MemoryMax=1G` (2G for archive-heavy security tests). On a normal terminal this wrapper is not a required Flucto dependency. It must not be treated as a reason to silently change a shared service's resource settings.

## Live upgrade and reproduction

The upstream nightly release2026.11.04.232659 was checked. Its zipapp SHA-256 was verified against the official release metadata:

`21f87ead735de22248806d9a55202eefbff98da25ed3a054ee03ae55878920ac`

The rebuilt repository CLI successfully ran:

```sh
node dist-electron/cli/index.js setup --force --yt-dlp-only \
  --bin-dir /home/declan/.local/opt/flucto-cli/bin --json
node dist-electron/cli/index.js download \
  'https://www.youtube.com/shorts/yIPCoGXmVe0' \
  --quality 1080p --format mp4 --check-only \
  --bin-dir /home/declan/.local/opt/flucto-cli/bin \
  --output-dir '<project>/01_SOURCE/reference_yIPCoGXmVe0' --json
```

Both returned exit0. Setup reported yt-dlp2026.11.04.232659. FFmpeg7.0.2 and Node24.22.0 were retained; no evidence required upgrading them. The original engine/managed marker backup is at `/home/declan/.local/opt/flucto-cli/backups/20261105-repair/`.

The exact reference video downloaded as `대부분 주식투자로 돈 잃는 진짜 이유 (김작가TV).mp4`,2,126,730 bytes. Actual ffprobe dimensions608x1080, duration59.489524s. The1080p preset must not be described as1080x1920: it selects a height-constrained rendition. This repair does not change quality-selection semantics or grant reuse rights.

Requested video metadata: ID `yIPCoGXmVe0`, uploader `김작가 TV`. Download/stream validation is distinct from playback, listening, reference analysis and reuse clearance. No cookies, login changes, paid provider calls or access-control bypass were used.

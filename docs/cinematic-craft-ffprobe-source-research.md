# FFprobe acquisition candidates — research only

Status: **not approved for shipping**. This records a read-only platform-worker survey; it does not change the accepted support matrix or establish release readiness.

The worker reported fetching these npm archives into disposable temporary storage, matching archive SHA-512 to npm registry `dist.integrity`, inspecting archive member names and binary headers, and not executing/installing the binaries:

| Target | Package/archive | Reported integrity | Reported contents/metadata |
|---|---|---|---|
| Linux x64 | `@ffprobe-installer/linux-x64@5.2.0` — `https://registry.npmjs.org/@ffprobe-installer/linux-x64/-/linux-x64-5.2.0.tgz` | `sha512-D3UeqTLYPNs7pBWPLUYGehPdRVqU8eACox4OZy3pZUZatxye2YKlvBwEfaLdL1v2Z4FOAlLUhms0kY8m8kqSRA==` | `package/ffprobe`; reported ELF x86-64, static; package metadata dates binary `20230721-c2b3861`, GPL-3.0. |
| Linux arm64 | `@ffprobe-installer/linux-arm64@5.2.0` — `https://registry.npmjs.org/@ffprobe-installer/linux-arm64/-/linux-arm64-5.2.0.tgz` | `sha512-X1VvWtlLs6ScP73biVLuHD5ohKJKsMTa0vafCESOen4mOoNeLAYbxOVxDWAdFz9cpZgRiloFj5QD6nDj8E28yQ==` | `package/ffprobe`; reported ELF AArch64, static; package metadata dates binary `20230721-c2b3861`, GPL-3.0. |
| Windows x64 | `@ffprobe-installer/win32-x64@5.1.0` — `https://registry.npmjs.org/@ffprobe-installer/win32-x64/-/win32-x64-5.1.0.tgz` | `sha512-jMGYeAgkrdn4e2vvYt/qakgHRE3CPju4bn5TmdPfoAm1BlX1mY9cyMd8gf5vSzI8gH8Zq5WQAyAkmekX/8TSTg==` | `package/ffprobe.exe`; reported PE32+ x86-64; metadata dates binary `20230213-2296078`, GPL-3.0. |
| macOS x64 | `@ffprobe-installer/darwin-x64@5.1.0` — `https://registry.npmjs.org/@ffprobe-installer/darwin-x64/-/darwin-x64-5.1.0.tgz` | `sha512-J+YGscZMpQclFg31O4cfVRGmDpkVsQ2fZujoUdMAAYcP0NtqpC49Hs3SWJpBdsGB4VeqOt5TTm1vSZQzs1NkhA==` | `package/ffprobe`; reported Mach-O x86_64; metadata dates binary `20230213-f8d6d0f`, GPL-3.0. |
| macOS arm64 | `@ffprobe-installer/darwin-arm64@5.0.1` — `https://registry.npmjs.org/@ffprobe-installer/darwin-arm64/-/darwin-arm64-5.0.1.tgz` | `sha512-vwNCNjokH8hfkbl6m95zICHwkSzhEvDC3GVBcUp5HX8+4wsX10SP3B+bGur7XUzTIZ4cQpgJmEIAx6TUwRepMg==` | `package/ffprobe`; reported Mach-O arm64; metadata identifies FFprobe 4.4.1 and LGPL-2.1. |

## Review and decision

An independent QA reviewer could not independently inspect the worker's temporary archives or validate these candidate-specific claims. The reviewer noted that an npm registry integrity value pins the exact npm tarball bytes, but does not by itself establish the bundled executable's upstream provenance, build options, or compatibility with Flucto's selected FFmpeg. Header inspection establishes an apparent format/architecture, not executable behavior. Package license metadata alone is not a legal review of the binary's build configuration or redistribution obligations.

The candidates are version-skewed and old relative to Flucto's current FFmpeg sources; macOS uses separate architecture builds and even different FFprobe major versions/licenses. No candidate has been executed, paired with the supported FFmpeg binary, or passed native fixture-probe tests. They are research leads, **not accepted sources**. Keep FFprobe setup/package claims blocked.

## Better pinned-source candidates identified later

A second platform-worker survey proposed using the exact same FFmpeg archive for both tools on Windows and Linux, and explicit versioned FFmpeg/FFprobe archives for macOS. The coordinator independently fetched the GitHub Release API metadata for the exact Gyan/BtbN release assets and the Martin Riedl SHA-256 sidecars; all reported digests matched the committed pins. The coordinator also fetched both macOS `versions.txt` files: both report FFmpeg 9.0.2 with `--enable-gpl` and no `--enable-nonfree`. This verifies publisher metadata/sidecars, not the downloaded archive contents or binary provenance. A read-only QA review considered these suitable as pinned implementation candidates, not release-approved. The current implementation pins URLs/hashes, verifies them before extraction, stages a pair, and tests rollback/size limits offline. At the time of this metadata review the binaries had not been downloaded or executed; see the dated Linux x64 real-archive smoke below.

- Windows x64: GyanD `8.1.2/ffmpeg-8.1.2-essentials_build.zip`, SHA-256 `db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec` (one archive containing both tools).
- Linux x64: BtbN `autobuild-2026-10-18-13-01/ffmpeg-N-127651-gb60ab6c9a4-linux64-gpl.tar.xz`, SHA-256 `a5f2aed198efa8ef4c12d9112f42e7cefbdf11dced1b59a87503ca689bc52277`.
- Linux arm64: same BtbN release/revision, `...linuxarm64-gpl.tar.xz`, SHA-256 `3d1ccdb45b01635e8404da39869f3a0c7a535b9e63470439bc3e677cf12fe266`.
- macOS x64: Martin Riedl build `1789931006_9.0.2`, FFmpeg SHA-256 `7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4`, FFprobe `2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd`.
- macOS arm64: Martin Riedl build `1789931890_9.0.2`, FFmpeg SHA-256 `c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924`, FFprobe `fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6`.

The worker reports these as GPL-enabled; the separate Martin Riedl Linux candidate was excluded because its build metadata reports `--enable-nonfree`. The coordinator independently verified the committed archive digests against GitHub Release API metadata (Windows/Linux) and SHA-256 sidecars (macOS), and confirmed the macOS `--enable-gpl` / no-`--enable-nonfree` configuration. GitHub/sidecar hashes pin archive bytes, not independent build provenance. Archive-member/architecture assertions reported by the worker, plus native version/pair/probe checks, still need independent/native verification. GPL legal review remains open.

## Linux x64 real-archive smoke (2026-10-19)

The pinned BtbN Linux x64 archive was downloaded to disposable `/tmp` storage and its SHA-256 independently matched the manifest: `a5f2aed198efa8ef4c12d9112f42e7cefbdf11dced1b59a87503ca689bc52277`. Its XZ-expanded TAR is 549,734,400 bytes, exceeding the previous 512 MiB decompression ceiling. This exposed a real installer failure; both runtime and package setup now allow up to 1 GiB expanded TAR and reuse one decompression for FFmpeg/FFprobe extraction from a shared archive.

The actual Linux x64 binaries were extracted to temporary storage and executed. Both report `N-127651-gb60ab6c9a4-20261018`; FFmpeg generated a 4-second synthetic MP4 and the matching FFprobe reported its duration and 320×240 video stream. The env-gated `tests/cinematic-real-av.integration.test.mjs` installed the real archive through runtime `setupUtilities()` using a local fetch fixture (checksum verification, one shared download, paired version check), and exercised the package setup TAR extractor against the same real archive with one cached decompression. It then ran compiled CLI analysis against generated media and a Basic-authenticated loopback mock only, using the package-extracted executables. It verified in-memory JPEG frames, explicit local consent, schema/reference-valid JSON, CSV/manifest exports, and no password/frame-file persistence. This is Linux x64 integration evidence only; it does not prove model accuracy, provider availability, package setup on other platforms, or onward-transmission behavior.

That run also exposed an FFmpeg 9 command incompatibility: `-vsync 0` is rejected as an unknown option. The keyframe command now uses `-fps_mode passthrough`; the real binary smoke confirmed JPEG output and the CLI run returned a labeled shot. The run is still recorded as `partial` because onward transmission from the local mock is intentionally unknown. No live provider was contacted. Windows, Linux arm64, both macOS architectures, and GPL redistribution review remain open. A local clean Linux x64 AppImage + CLI package smoke later passed; it does not cover the other native targets.

## Packaging repair (2026-11-05, PONS-6)

The 2026-10-18 daily Linux release now returns HTTP 404 (release API and both archive HEAD requests). BtbN's [current retention policy](https://github.com/BtbN/FFmpeg-Builds#release-retention-policy) keeps only 14 daily builds, but keeps the last build of each month for two years. This is an expired pin, not a reason to retry indefinitely or relax integrity checks. Use an explicitly dated month-end release when refreshing these pins; check both architectures against publisher metadata, and rerun native archive/pair smoke before release. Month-end retention is finite, not a permanent availability guarantee.

Packaging and runtime now select `autobuild-2026-10-31-12-59`, revision `N-128227-g4811625b5f`, still from BtbN's GPL archives:

| Target | Asset | Publisher SHA-256 |
|---|---|---|
| Linux x64 | `ffmpeg-N-128227-g4811625b5f-linux64-gpl.tar.xz` | `67929be39bbb696f41d3295686597a439aeac902f61d82be660ccc1453c1fdfb` |
| Linux arm64 | `ffmpeg-N-128227-g4811625b5f-linuxarm64-gpl.tar.xz` | `9064bc53f3b268865f5a5370c9f7e98d86bbdde5820ec7f6928df2beaa1d586e` |

Read-only checks of the [exact release metadata](https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/autobuild-2026-10-31-12-59) and archive HEAD responses matched both configured digests to publisher metadata and both content lengths (157360624 / 132627620 bytes), with HTTP 200. These are **metadata/availability checks only**: the replacement archives were not downloaded, installed or executed locally. The earlier 2026-10-19 real-archive smoke does not validate this new revision. Existing checksum rejection, extraction limits, pair identity checks and rollback remain mandatory and unchanged; native packaging stays an explicit validation gap.

The same CI run exposed an independent Windows test-fixture defect: the common CLI archive is built on Linux (LF), while Windows Git checkout may convert skill Markdown to CRLF. `.gitattributes` now forces LF only under `skills/**`. The regression materializes tracked files with Git `core.autocrlf=true` and compares exact Git blob bytes. The package smoke's strict installed-file byte comparison is retained without normalization or skipping. This Git-policy simulation on Linux is not a Windows installer run.

## Requirements before adoption/release

1. Independently reproduce exact archive digests, member paths, binary versions/configuration, architectures, release IDs, and source metadata.
2. Approve redistribution/licensing obligations for each binary/build.
3. Run native install/package smoke for Windows x64, Linux x64/arm64, and macOS x64/arm64. Execute `-version`, verify architecture, and probe a generated fixture with the packaged FFmpeg/FFprobe pair.
4. Confirm the universal macOS pair contains both architectures and that packaged app signing/quarantine behavior works.

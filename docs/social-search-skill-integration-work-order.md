# Work order: Bundle Flucto social-search agent skill

## Goal
Ship the reviewed `searching-social-media` Flucto 1.19.0 adapter/skill as part of Flucto distributions so an installed CLI user can explicitly install it into supported agent skill directories. Update README and provide a Korean setup/use guide. Keep skill installation opt-in; never alter agent homes automatically during Flucto installation.

## Scope
- Vendor the reviewed skill and Python adapter under Flucto's own `skills/searching-social-media/` tree; preserve its use boundaries, current Flucto version guard, metric/date uncertainty, and no-download/cookie/install behavior.
- Include the skill in npm and desktop package assets.
- Add an explicit CLI installer (`flucto skill install`) targeting Pi, Codex, Claude, or all, with dry-run, existing-target refusal, and an explicit force option. Copy bundled content atomically enough to avoid partial installs; never execute skill code during installation.
- Document prerequisites, installation, refresh/removal, invocation, search examples, platform/metadata limitations, and the difference between Flucto search and media download.
- Add offline tests for platform target resolution, dry-run, refusal/force, packaged path discovery, and no overwrite of unrelated paths.

## Safety/compatibility
- No global/user agent install as part of the Flucto app/package installer. Skill directory write occurs only after the explicit command.
- Never overwrite a pre-existing skill without `--force`; force applies only to the exact managed `searching-social-media` destination and preserves a dated backup.
- No cookies, login, download, transcript, update, network call, or binary provisioning during skill installation.
- Keep unrelated working-tree changes; do not commit or push without request.

## Acceptance
- [x] Bundled skill source matches the reviewed implementation and docs.
- [x] npm tarball dry-run and Electron package configuration include the skill.
- [x] CLI supports explicit install for Pi, Codex, Claude, and all; `--dry-run` is side-effect-free. `all` shares the Codex `~/.agents/skills` copy with Pi to avoid duplicate-name collisions.
- [x] Existing destination is refused; `--force` moves only the exact skill target to a sibling timestamped backup.
- [x] README links the Korean install/use guide.
- [x] Offline CLI tests (6 new), full test suite, typecheck/build and npm package-content smoke pass.
- [x] No release, commit or push performed.

## Verification record

- `npm test`: 214 passed, 1 skipped (existing optional FFmpeg/FFprobe real-media test), 0 failed.
- `npm run typecheck`: passed; `npm run build:electron`: passed.
- `npm pack --dry-run --json`: confirmed `SKILL.md`, adapter and both references enter the npm package.
- CLI end-to-end tests use temporary HOME directories; they verify dry run/no write, Pi/Codex/Claude/all paths (with Pi/Codex shared discovery), conflict refusal, scoped backup/replace and exact installed bundle file list. No real agent home was changed by these tests.
- Python adapter is the reviewed standard-library implementation; installation command only copies files and makes no network or binary calls.
- `skills/searching-social-media` is copied from repository skill files, with its Python test suite excluded from end-user payload.
- Worktree is on `validation/cinematic-analysis-release`; no commit, push, release build/upload, or real global agent installation was done.

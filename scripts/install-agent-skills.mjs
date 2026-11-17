#!/usr/bin/env node
// npm's global install hook: local development installs never change agent homes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const globalInstall = process.env.npm_config_global === 'true';
const skip = process.env.FLUCTO_SKIP_AGENT_SKILLS === '1';

if (globalInstall && !skip) {
  const cli = path.join(root, 'dist-electron', 'cli', 'index.js');
  if (!fs.existsSync(cli)) {
    console.error('[flucto] Agent skill not installed: compiled CLI is missing. Build Flucto, then run flucto skill install --agent all --skill flucto-media-research --if-missing.');
  } else {
    const result = spawnSync(process.execPath, [
      cli, 'skill', 'install', '--agent', 'all', '--skill', 'flucto-media-research', '--if-missing', '--json',
    ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    if (result.status === 0) {
      console.error(`[flucto] Agent skill registration: ${result.stdout.trim()}`);
      console.error('[flucto] Reload/restart your agent to discover flucto-media-research. Existing skill directories were preserved.');
    } else {
      // Skill discovery is optional: do not break the CLI installation on a protected home.
      console.error(`[flucto] Agent skill registration incomplete: ${result.error?.message ?? result.stderr?.trim() ?? 'unknown error'}`);
      console.error('[flucto] Retry explicitly: flucto skill install --agent all --skill flucto-media-research --if-missing');
    }
  }
}

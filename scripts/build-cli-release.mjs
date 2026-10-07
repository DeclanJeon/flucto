#!/usr/bin/env node
// Build the one-shot CLI setup archive for this package version:
//   node scripts/build-cli-release.mjs [--output <dir>] [--tarball <path>]
//
// Produces <output>/Flucto-<version>-cli-setup.zip containing exactly:
//   install.cmd, install.ps1, install.sh, <name>-<version>.tgz
// With no --tarball it runs `npm pack` (which runs the prepack build) so the
// tarball always matches the package.json version.
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP_DIR = path.join(repoRoot, 'scripts', 'cli-setup');
const BOOTSTRAP_FILES = ['install.cmd', 'install.ps1', 'install.sh'];

const parseArgs = (argv) => {
  const options = { output: 'release', tarball: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = argv[++index];
    } else if (arg === '--tarball') {
      options.tarball = argv[++index];
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!options.output) throw new Error('--output requires a directory');
  return options;
};

const readPackage = async () => {
  const pkg = JSON.parse(await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  if (!pkg.name || !pkg.version) throw new Error('package.json is missing name or version');
  return { name: String(pkg.name), version: String(pkg.version) };
};

// npm pack prints the produced tarball filename as the last non-notice line.
const packTarball = async (packDir) => {
  const npmCli = process.env.npm_execpath
    ?? (process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : null);
  const { stdout } = await execFileAsync(
    npmCli ? process.execPath : 'npm',
    [...(npmCli ? [npmCli] : []), 'pack', '--pack-destination', packDir],
    { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 },
  );
  const filename = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop();
  if (!filename || filename.includes('/') || filename.includes('\\')) {
    throw new Error(`npm pack did not report a tarball filename: ${JSON.stringify(filename)}`);
  }
  const tarballPath = path.join(packDir, filename);
  const stat = await fsp.stat(tarballPath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`npm pack output ${filename} was not produced in ${packDir}`);
  return tarballPath;
};

// Validate the tarball is a real npm package for the expected name/version.
const inspectTarball = async (tarballPath, { name, version }) => {
  const list = await execFileAsync('tar', ['-tzf', tarballPath], { maxBuffer: 16 * 1024 * 1024 }).catch(() => null);
  if (list) {
    if (!list.stdout.split(/\r?\n/).some((entry) => entry.replace(/^\.\//, '') === 'package/package.json')) {
      throw new Error(`${path.basename(tarballPath)} is not an npm package tarball (no package/package.json)`);
    }
  }
  const extractDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'flucto-tarball-'));
  try {
    await execFileAsync('tar', ['-xzf', tarballPath, '-C', extractDir, 'package/package.json']);
    const packed = JSON.parse(await fsp.readFile(path.join(extractDir, 'package', 'package.json'), 'utf8'));
    if (packed.name !== name || packed.version !== version) {
      throw new Error(
        `tarball contains ${packed.name}@${packed.version} but package.json is ${name}@${version} — rebuild the package`,
      );
    }
  } finally {
    await fsp.rm(extractDir, { recursive: true, force: true });
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/build-cli-release.mjs [--output <dir>] [--tarball <path>]');
    return;
  }

  const { name, version } = await readPackage();
  const outputDir = path.resolve(repoRoot, options.output);
  await fsp.mkdir(outputDir, { recursive: true });

  for (const file of BOOTSTRAP_FILES) {
    const stat = await fsp.stat(path.join(BOOTSTRAP_DIR, file)).catch(() => null);
    if (!stat?.isFile()) throw new Error(`missing bootstrap script: scripts/cli-setup/${file}`);
  }

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'flucto-cli-release-'));
  try {
    const tarballPath = options.tarball
      ? path.resolve(options.tarball)
      : await packTarball(workDir);
    await inspectTarball(tarballPath, { name, version });

    const archiveName = `Flucto-${version}-cli-setup.zip`;
    const archivePath = path.join(outputDir, archiveName);
    const zip = new AdmZip();
    // One npm tarball + the three bootstrap entrypoints — nothing else.
    zip.addFile(path.basename(tarballPath), await fsp.readFile(tarballPath));
    for (const file of BOOTSTRAP_FILES) {
      zip.addLocalFile(path.join(BOOTSTRAP_DIR, file));
    }
    const entries = zip.getEntries().map((entry) => entry.entryName).sort();
    const expected = [path.basename(tarballPath), ...BOOTSTRAP_FILES].sort();
    if (JSON.stringify(entries) !== JSON.stringify(expected)) {
      throw new Error(`archive contents mismatch: ${JSON.stringify(entries)}`);
    }
    zip.writeZip(archivePath);
    console.log(`wrote ${archivePath} (${entries.length} entries: ${entries.join(', ')})`);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

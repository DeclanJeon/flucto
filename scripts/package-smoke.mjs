#!/usr/bin/env node
// Runs installers in disposable CI runners. --cli-only is safe for an isolated local prefix.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import asar from '@electron/asar';

const exec = promisify(execFile);
const releaseDir = path.resolve('release');
const version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
const cliOnly = process.argv.includes('--cli-only');
if (!cliOnly && process.platform === 'win32' && !process.env.CI) {
  throw new Error('Desktop installer smoke requires a disposable CI runner; use --cli-only locally.');
}
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flucto-package-smoke-')));
const cliHome = path.join(root, 'cli');
const setupDir = path.join(root, 'setup');
const mediaDir = path.join(root, 'media');
let desktop;
let desktopExit;
let socket;
let server;
let mounted = false;
const mount = path.join(root, 'dmg');

const run = async (file, args, options = {}) => {
  const result = await exec(file, args, { maxBuffer: 4 * 1024 * 1024, timeout: 180000, ...options });
  return result.stdout.trim();
};
const findFile = async (suffix) => {
  const matches = (await fs.readdir(releaseDir)).filter((name) => name.endsWith(suffix));
  assert.equal(matches.length, 1, `Expected one release file ending ${suffix}`);
  return path.join(releaseDir, matches[0]);
};
const waitFor = async (probe, description, timeout = 60000) => {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${description}: ${lastError?.message ?? 'not ready'}`);
};

const stopDesktop = async () => {
  socket?.close();
  socket = undefined;
  if (desktop && desktop.exitCode === null) {
    if (process.platform === 'win32') desktop.kill();
    else process.kill(-desktop.pid, 'SIGTERM');
    await desktopExit;
  }
  desktop = undefined;
};

try {
  await fs.mkdir(setupDir);
  const profileHome = path.join(root, 'profile-home');
  await fs.mkdir(profileHome);
  const cliEnv = process.platform === 'win32' ? process.env : { ...process.env, HOME: profileHome };
  new AdmZip(await findFile(`-${version}-cli-setup.zip`)).extractAllTo(setupDir, true);
  if (process.platform === 'win32') {
    console.log(await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(setupDir, 'install.ps1'), '-InstallDir', cliHome, ...(cliOnly ? ['-NoProfile'] : [])]));
  } else {
    console.log(await run('bash', [path.join(setupDir, 'install.sh'), '--install-dir', cliHome, ...(cliOnly ? ['--no-profile'] : [])], { env: cliEnv }));
  }
  const privateNode = path.join(cliHome, process.platform === 'win32' ? 'node.exe' : 'bin/node');
  const cliEntry = path.join(cliHome, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'flucto/dist-electron/cli/index.js');
  const cli = async (args) => run(privateNode, [cliEntry, ...args], { env: cliEnv });
  assert.equal(await cli(['--version']), version);
  if (process.platform === 'win32') {
    const launcherVersions = await run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Restricted', '-Command',
      `$ErrorActionPreference='Stop'; $env:PATH='${cliHome};'+$env:SystemRoot+'\\System32'; flucto --version; fl.cmd --version`,
    ]);
    assert.deepEqual(launcherVersions.split(/\r?\n/), [version, version]);
  } else if (!cliOnly) {
    const profile = path.join(profileHome, process.platform === 'darwin' ? '.bash_profile' : '.profile');
    assert.equal(await run('bash', ['-c', '. "$1"; command -v flucto', 'profile-proof', profile], { env: cliEnv }), path.join(cliHome, 'bin/flucto'));
    const shellHealth = JSON.parse(await run('bash', ['-c', '. "$1"; flucto doctor --json', 'profile-proof', profile], { env: cliEnv }));
    assert.equal(shellHealth.valid, true, JSON.stringify(shellHealth));
    assert.equal(path.dirname(shellHealth.paths.ffmpegPath), path.join(cliHome, 'bin'));
  }
  const health = JSON.parse(await cli(['doctor', '--json']));
  assert.equal(health.valid, true, JSON.stringify(health));
  assert.equal(path.dirname(health.paths.ytDlpPath), path.join(cliHome, 'bin'));
  assert.equal(path.dirname(health.paths.ffmpegPath), path.join(cliHome, 'bin'));
  await fs.mkdir(mediaDir);
  const fixture = path.join(root, 'fixture.mp4');
  await run(health.paths.ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', fixture]);
  const bytes = await fs.readFile(fixture);
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const mediaUrl = (name) => `http://127.0.0.1:${server.address().port}/${name}.mp4`;
  const assertMedia = async (result) => {
    assert.equal(result.success, true, JSON.stringify(result));
    assert.ok(result.filePath.endsWith('.mp3'), `Not the converted MP3: ${result.filePath}`);
    await run(health.paths.ffmpegPath, ['-v', 'error', '-i', result.filePath, '-f', 'null', '-']);
  };
  await assertMedia(JSON.parse(await cli(['download', mediaUrl('cli'), '--format', 'mp3', '--out', mediaDir, '--json'])));
  console.log(`CLI bootstrap, native utilities, and playable MP3 conversion verified: ${version}`);

  if (!cliOnly) {
    let executable;
    let resources;
    if (process.platform === 'win32') {
      const destination = path.join(root, 'desktop');
      await run(await findFile(`-${version}-x64-setup.exe`), ['/S', `/D=${destination}`]);
      executable = path.join(destination, 'Flucto.exe');
      resources = path.join(destination, 'resources');
    } else if (process.platform === 'darwin') {
      await fs.mkdir(mount);
      await run('hdiutil', ['attach', await findFile(`-${version}-universal.dmg`), '-nobrowse', '-readonly', '-mountpoint', mount]);
      mounted = true;
      const appDir = path.join(root, 'Flucto.app');
      await run('ditto', [path.join(mount, 'Flucto.app'), appDir]);
      executable = path.join(appDir, 'Contents/MacOS/Flucto');
      resources = path.join(appDir, 'Contents/Resources');
      const ffmpegArch = await run('lipo', ['-archs', path.join(resources, 'bin/ffmpeg')]);
      assert.match(ffmpegArch, /x86_64/);
      assert.match(ffmpegArch, /arm64/);
      const executableArch = await run('lipo', ['-archs', executable]);
      assert.match(executableArch, /x86_64/);
      assert.match(executableArch, /arm64/);
    } else {
      const appImage = await findFile(`-${version}-x86_64.AppImage`);
      await fs.chmod(appImage, 0o755);
      await run(appImage, ['--appimage-extract'], { cwd: root });
      executable = appImage;
      resources = path.join(root, 'squashfs-root/resources');
    }
    const packaged = JSON.parse(asar.extractFile(path.join(resources, 'app.asar'), 'package.json').toString());
    assert.equal(packaged.version, version);
    const bundledFfmpeg = path.join(resources, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const bundledYt = path.join(resources, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    await run(bundledYt, ['--version']);
    await run(bundledFfmpeg, ['-version']);
    const cpu = process.arch;
    const port = 38147;
    const screenshotPath = path.join(releaseDir, `package-smoke-${process.platform}-${cpu}.png`);
    const desktopUrl = (name) => mediaUrl(`${cpu}-${name}`);
    // CI Linux lacks a configured interactive desktop sandbox; production switches are unchanged.
    const args = [...(process.platform === 'linux' ? ['--appimage-extract-and-run'] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(root, `desktop-profile-${cpu}`)}`, '--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
    desktop = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    desktopExit = new Promise((resolve) => desktop.once('exit', resolve));
    let launchOutput = '';
    desktop.stdout.on('data', (data) => { launchOutput += data; });
    desktop.stderr.on('data', (data) => { launchOutput += data; });
    desktop.on('error', (error) => { launchOutput += error.message; });
    const target = await waitFor(async () => {
      if (desktop.exitCode !== null) throw new Error(`Desktop exited: ${launchOutput}`);
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
      return (await response.json()).find((entry) => entry.type === 'page' && entry.url.startsWith('file:'));
    }, 'installed desktop renderer').catch((error) => { throw new Error(`${error.message}\nDesktop output:\n${launchOutput}`, { cause: error }); });
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const callback = pending.get(message.id);
      if (!callback) return;
      pending.delete(message.id);
      if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
      else callback.resolve(message.result);
    });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await waitFor(() => evaluate('Boolean(window.api && document.querySelector("button"))'), 'real preload and rendered UI');
    await evaluate(`window.api.setDownloadDirectory(${JSON.stringify(mediaDir)})`);
    const previous = await evaluate('window.api.getDownloadSettings()');
    await evaluate(`window.api.setDownloadSettings(${JSON.stringify({ ...previous, notifyPerItemInBatch: !previous.notifyPerItemInBatch })})`);
    const previousOrigin = await evaluate('performance.timeOrigin');
    await cdp('Page.reload');
    await waitFor(() => evaluate(`Boolean(window.api && document.querySelector("button") && performance.timeOrigin !== ${previousOrigin})`), 'reloaded UI');
    assert.equal((await evaluate('window.api.getDownloadSettings()')).notifyPerItemInBatch, !previous.notifyPerItemInBatch);
    const single = await evaluate(`window.api.downloadSingle(${JSON.stringify({ url: desktopUrl('desktop-single'), format: 'mp3', requestId: 'package-single' })})`);
    await assertMedia(single);
    const legacy = await evaluate(`window.api.downloadVideo(${JSON.stringify({ url: desktopUrl('desktop-single-hook'), format: 'mp3' })})`);
    await assertMedia(legacy);
    const batchUrls = [desktopUrl('desktop-batch-a'), desktopUrl('desktop-batch-b')];
    await evaluate(`window.api.downloadMultiple(${JSON.stringify(batchUrls)},'mp3')`);
    const history = await evaluate('window.api.getDownloadHistory()');
    for (const url of batchUrls) {
      const item = history.find((entry) => entry.url === url);
      assert.equal(item?.status, 'success', JSON.stringify(item));
      await assertMedia({ success: true, filePath: item.filePath });
    }
    await evaluate('document.fonts.ready');
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    console.log(`Installed desktop ${cpu} main/preload/UI, persisted settings, single/batch playable MP3 paths verified: ${version}`);
    console.log(`Native screenshot: ${screenshotPath}`);
    await stopDesktop();
  }
} finally {
  await stopDesktop();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mounted) await run('hdiutil', ['detach', mount]);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

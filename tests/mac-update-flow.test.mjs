import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { app, dialog, shell } from 'electron';
import {
  checkForAppUpdates,
  downloadAppUpdate,
  getCurrentAppUpdateEvent,
  installDownloadedAppUpdate,
  macUpdateHooks,
} from '../dist-electron/main/updater.js';

// Electron stub overrides: pretend to be a packaged app on macOS.
const tempDirs = [];
const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-update-'));
  tempDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const downloadsDir = makeTempDir();
const openedPaths = [];
const dialogs = [];

before(() => {
  app.isPackaged = true;
  app.getVersion = () => '1.0.0';
  app.getPath = (name) => (name === 'downloads' ? downloadsDir : makeTempDir());
  shell.openPath = async (target) => {
    openedPaths.push(target);
    return '';
  };
  dialog.showMessageBox = async (options) => {
    dialogs.push(options);
    return { response: 0 };
  };
  macUpdateHooks.isMacPlatform = () => true;
});

const release = {
  tagName: 'v9.9.9',
  version: '9.9.9',
  url: 'https://github.com/DeclanJeon/flucto/releases/tag/v9.9.9',
  publishedAt: '2026-10-01T00:00:00Z',
  assets: [
    { name: 'Flucto-9.9.9-universal.dmg', url: 'https://example.test/universal.dmg', size: 42, contentType: 'application/octet-stream' },
    { name: 'Flucto-9.9.9-universal.zip', url: 'https://example.test/universal.zip', size: 40, contentType: 'application/zip' },
    { name: 'checksums-sha256.txt', url: 'https://example.test/checksums.txt', size: 10, contentType: 'text/plain' },
  ],
};


test('unsigned macOS update: check → download → open installer flow', async () => {

  macUpdateHooks.fetchRelease = async () => release;
  macUpdateHooks.downloadAsset = async ({ asset, outputDir }) => {
    const file = path.join(outputDir, asset.name);
    await fs.promises.mkdir(outputDir, { recursive: true });
    await fs.promises.writeFile(file, 'dmg-bytes');
    return { path: file, checksumVerified: true };
  };

  await checkForAppUpdates(true);
  assert.equal(getCurrentAppUpdateEvent().type, 'available');
  assert.equal(getCurrentAppUpdateEvent().version, '9.9.9');
  assert.equal(getCurrentAppUpdateEvent().installationMode, 'installer');

  await downloadAppUpdate();
  const downloaded = getCurrentAppUpdateEvent();
  assert.equal(downloaded.type, 'downloaded');
  assert.equal(downloaded.installationMode, 'installer');
  assert.match(downloaded.downloadedFile ?? '', /universal\.dmg$/);

  await installDownloadedAppUpdate();
  assert.equal(openedPaths.at(-1), downloaded.downloadedFile);
});

test('mac update check emits not-available when release is not newer', async () => {
  macUpdateHooks.fetchRelease = async () => ({ ...release, tagName: 'v0.0.1', version: '0.0.1' });
  await checkForAppUpdates(true);
  const event = getCurrentAppUpdateEvent();
  assert.equal(event.type, 'not-available');
  assert.equal(event.installationMode, 'installer');
});

test('failed mac download surfaces an error event and never reports installed', async () => {
  macUpdateHooks.fetchRelease = async () => release;
  macUpdateHooks.downloadAsset = async () => {
    throw new Error('Checksum verification failed for Flucto-9.9.9-universal.dmg');
  };
  // Force a fresh check so macAsset/macRelease are repopulated.
  await checkForAppUpdates(true);
  await assert.rejects(downloadAppUpdate(), /Checksum verification failed/);
  const event = getCurrentAppUpdateEvent();
  assert.equal(event.type, 'error');
  assert.match(event.message ?? '', /Checksum verification failed/);
});

test('macOS refuses internal ZIP payloads when the universal DMG installer is absent', async () => {
  macUpdateHooks.fetchRelease = async () => ({
    ...release,
    assets: release.assets.filter((asset) => !asset.name.endsWith('.dmg')),
  });
  await checkForAppUpdates(true);
  const openedBefore = [...openedPaths];
  await assert.rejects(downloadAppUpdate(), /does not include a macOS installer/);
  assert.equal(getCurrentAppUpdateEvent().type, 'error');
  assert.deepEqual(openedPaths, openedBefore);
});

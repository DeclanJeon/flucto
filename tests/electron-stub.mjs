import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flucto-electron-tests-'));
process.once('exit', () => fs.rmSync(root, { recursive: true, force: true }));

export const app = {
  isPackaged: false,
  getVersion() { return '1.0.0'; },
  getAppPath() {
    return process.cwd();
  },
  getPath(name) {
    return path.join(root, name);
  },
};

export const clipboard = {
  writeText() {},
};

export const ipcMain = {
  handle() {},
  on() {},
  removeHandler() {},
};

export const dialog = {
  showErrorBox() {},
  showMessageBox: async () => ({ response: 0 }),
};

export const shell = {
  openExternal: async () => {},
  openPath: async () => '',
};

export class BrowserWindow {}
export class Notification {}

export default { app, clipboard, ipcMain, dialog, shell, BrowserWindow, Notification };

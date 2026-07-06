import os from 'node:os';
import path from 'node:path';

const root = path.join(os.tmpdir(), 'flucto-transcript-tests');

export const app = {
  isPackaged: false,
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
};

export class BrowserWindow {}
export class Notification {}

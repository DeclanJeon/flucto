import fs from 'fs';
import os from 'os';
import path from 'path';

export const resolveDocumentsDirectory = (
  home = os.homedir(),
  platform = process.platform,
  xdgConfigHome = process.env.XDG_CONFIG_HOME,
): string => {
  if (platform !== 'linux') return path.join(home, 'Documents');

  const configPath = path.join(xdgConfigHome || path.join(home, '.config'), 'user-dirs.dirs');
  try {
    const configuration = fs.readFileSync(configPath, 'utf8');
    const entry = configuration.match(/^XDG_DOCUMENTS_DIR=(.+)$/m)?.[1]?.trim();
    if (entry) {
      const unquoted = entry.replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');
      const expanded = unquoted.replace(/\$HOME/g, home);
      if (expanded && !expanded.includes('$')) return path.isAbsolute(expanded) ? expanded : path.resolve(home, expanded);
    }
  } catch {
    // Fall back to the conventional Documents folder if XDG user dirs are absent.
  }
  return path.join(home, 'Documents');
};

export const defaultAnalysisOutputDirectory = (documentsDirectory = resolveDocumentsDirectory()): string =>
  path.join(documentsDirectory, 'flucto');

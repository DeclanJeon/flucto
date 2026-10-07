import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { after, mock } from 'node:test';

// Keep real child-process IO while replacing only the external utility executable.
// Node can run the fixture on every OS; Windows cannot execute a shell-script .exe.
export function createExecutableFixtures() {
  const fixtures = new Set();
  const nativeSpawn = childProcess.spawn;
  const spawnMock = mock.method(childProcess, 'spawn', (file, args = [], options) => {
    if (!fixtures.has(path.resolve(file))) return nativeSpawn(file, args, options);
    return nativeSpawn(process.execPath, [file, ...args], options);
  });
  syncBuiltinESMExports();
  after(() => {
    spawnMock.mock.restore();
    syncBuiltinESMExports();
  });

  return (filePath, output = 'ok') => {
    fixtures.add(path.resolve(filePath));
    fs.writeFileSync(filePath, `if (!['--version', '-version'].includes(process.argv[2])) process.exit(2);\nconsole.log(${JSON.stringify(output)});\n`);
    fs.chmodSync(filePath, 0o755);
    return filePath;
  };
}

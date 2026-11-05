import { spawn, exec } from 'child_process';

export interface ExecaResult {
  stdout: string;
  stderr: string;
  failed: boolean;
  command: string;
  readonly timedOut?: boolean;
}

export interface ExecaOptions {
  reject?: boolean;
}

export interface ExecaProcessOptions extends ExecaOptions {
  readonly timeoutMs?: number;
}

export interface ExecaChildProcess extends Promise<ExecaResult> {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: string | number): void;
}

export function execa(
  file: string,
  args?: string[],
  options?: ExecaProcessOptions
): ExecaChildProcess {
  const shouldReject = options?.reject !== false;
  const timeoutMs = options?.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new RangeError('timeoutMs must be a positive finite number');
  }
  const childProcess = spawn(file, args || [], {
    shell: false,
    windowsHide: true,
    // Isolate bounded probes so a bootloader's child cannot keep their pipes open.
    detached: timeoutMs !== undefined && process.platform !== 'win32',
  });
  let timedOut = false;
  let deadline: NodeJS.Timeout | undefined;
  let forceKill: NodeJS.Timeout | undefined;
  const clearDeadline = (): void => {
    if (deadline) clearTimeout(deadline);
    if (forceKill) clearTimeout(forceKill);
  };
  const killTree = (signal: NodeJS.Signals): void => {
    const pid = childProcess.pid;
    if (pid === undefined) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
      killer.once('error', () => { childProcess.kill(signal); });
      return;
    }
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
        childProcess.kill(signal);
      }
    }
  };
  if (timeoutMs !== undefined) {
    deadline = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      forceKill = setTimeout(() => { killTree('SIGKILL'); }, 250);
    }, timeoutMs);
  }

  let stdout = '';
  let stderr = '';

  childProcess.stdout?.on('data', (data) => {
    stdout += data.toString('utf8');
  });

  childProcess.stderr?.on('data', (data) => {
    stderr += data.toString('utf8');
  });

  const promise = new Promise<ExecaResult>((resolve, reject) => {
    childProcess.on('error', (error) => {
      clearDeadline();
      if (shouldReject) {
        reject(error);
      } else {
        resolve({
          stdout: '',
          stderr: error.message,
          failed: true,
          command: `${file} ${(args || []).join(' ')}`,
        });
      }
    });

    childProcess.on('close', (code) => {
      clearDeadline();
      const failureText = timedOut
        ? `${stderr}${stderr ? '\n' : ''}Process timed out after ${timeoutMs}ms`
        : stderr;
      if ((code === 0 && !timedOut) || !shouldReject) {
        resolve({
          stdout,
          stderr: failureText,
          failed: timedOut || code !== 0,
          command: `${file} ${(args || []).join(' ')}`,
          ...(timedOut ? { timedOut: true } : {}),
        });
      } else {
        const error = new Error(timedOut ? failureText : `Command failed with exit code ${code}: ${stderr || stdout}`);
        const detailedError: Error & { stdout: string; stderr: string; code: number | null } = Object.assign(error, {
          stdout,
          stderr,
          code,
        });
        reject(detailedError);
      }
    });
  });

  const result = promise as ExecaChildProcess;
  result.stdout = childProcess.stdout;
  result.stderr = childProcess.stderr;
  result.kill = childProcess.kill.bind(childProcess);

  return result;
}

export function execaCommand(command: string, options?: ExecaOptions): Promise<ExecaResult> {
  const shouldReject = options?.reject !== false;
  
  return new Promise((resolve, reject) => {
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
      if (error && shouldReject) {
        reject(error);
      } else {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          failed: !!error,
          command,
        });
      }
    });
  });
}

import { spawn, exec } from 'child_process';

export interface ExecaResult {
  stdout: string;
  stderr: string;
  failed: boolean;
  command: string;
}

export interface ExecaOptions {
  reject?: boolean;
}

export interface ExecaChildProcess extends Promise<ExecaResult> {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: string | number): void;
}

export function execa(
  file: string,
  args?: string[],
  options?: ExecaOptions
): ExecaChildProcess {
  const shouldReject = options?.reject !== false;
  
  const childProcess = spawn(file, args || [], {
    shell: false,
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';

  childProcess.stdout?.on('data', (data) => {
    stdout += data.toString();
  });

  childProcess.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  const promise = new Promise<ExecaResult>((resolve, reject) => {
    childProcess.on('error', (error) => {
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
      if (code === 0 || !shouldReject) {
        resolve({
          stdout,
          stderr,
          failed: code !== 0,
          command: `${file} ${(args || []).join(' ')}`,
        });
      } else {
        const error = new Error(`Command failed with exit code ${code}: ${stderr || stdout}`);
        (error as any).stdout = stdout;
        (error as any).stderr = stderr;
        (error as any).code = code;
        reject(error);
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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

export async function hasUpstream(cwd: string): Promise<boolean> {
  try {
    await git(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
    return true;
  } catch {
    return false;
  }
}

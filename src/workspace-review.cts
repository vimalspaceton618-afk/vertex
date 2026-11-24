import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, relative } from 'node:path';
import { promisify, stripVTControlCharacters } from 'node:util';

const exec = promisify(execFile);

function cleanOutput(value: string): string {
  return stripVTControlCharacters(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

export async function reviewWorkspace(directory: string) {
  const root = await realpath(directory);
  const env: NodeJS.ProcessEnv = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.PATH = (process.env.PATH ?? '').split(delimiter).filter(entry => {
    if (!isAbsolute(entry)) return false;
    const fromRoot = relative(root, entry);
    return fromRoot.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) ||
      fromRoot === '..' || isAbsolute(fromRoot);
  }).join(delimiter);

  async function git(...args: string[]) {
    const result = await exec('git', [
      '-C', root, '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=true',
      '-c', 'core.hooksPath=' + env.GIT_CONFIG_GLOBAL, '--no-pager', ...args
    ], {
      cwd: dirname(process.execPath), env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000, windowsHide: true
    });
    return cleanOutput(result.stdout);
  }

  try {
    if ((await git('rev-parse', '--show-prefix')).trim()) {
      throw new Error('Select the root of the Git repository.');
    }
    const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all'];
    const [status, staged, unstaged] = await Promise.all([
      git('status', '--short', '--untracked-files=normal', '--ignore-submodules=all'),
      git(...diffArgs, '--cached', '--'),
      git(...diffArgs, '--'),
    ]);
    return { root, status, staged, unstaged };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (failure.code === 'ENOENT') throw new Error('Git was not found on PATH.');
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('This review exceeds the 2 MiB per-command output limit.');
    if (failure.killed) throw new Error('Git review timed out.');
    if (failure.stderr) throw new Error(cleanOutput(failure.stderr).trim());
    throw error;
  }
}

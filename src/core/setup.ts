import * as fs from 'node:fs';
import * as path from 'node:path';

export type WorkspaceInitResult = { created: boolean; path: string; message: string };

export const WORKSPACE_ENV_TEMPLATE = `# VERTEX workspace configuration
# This file may contain credentials. Keep it private and never commit it.
# Add your provider key only on a trusted machine.
OPENAI_API_KEY=
# Optional OpenAI-compatible cloud endpoint. Leave blank to use the SDK default.
OPENAI_BASE_URL=
# Optional model name. Leave blank to use the runtime default.
AI_MODEL=
# cloud, local, or offline.
BRAIN_MODE=cloud
# Local OpenAI-compatible endpoint (for example, Ollama). Used only in local/offline mode.
LOCAL_BASE_URL=http://127.0.0.1:11434/v1
# Set this when using local/offline mode.
LOCAL_MODEL=
# Optional workspace restriction. This key is WORKSPACE_ROOT in global config.
WORKSPACE_ROOT=
# Subprocess timeout in milliseconds.
SHELL_TIMEOUT_MS=60000
`;

/**
 * Create a starter .env only when none exists. O_EXCL prevents overwriting existing files
 * and refuses to follow a pre-existing symlink at the destination. The descriptor remains
 * open while writing so failure cleanup can verify the path still names the file we created.
 */
export function initializeWorkspaceConfig(cwd: string = process.cwd()): WorkspaceInitResult {
  const targetPath = path.join(path.resolve(cwd), '.env');
  let fd: number | undefined;
  let createdIdentity: { dev: number; ino: number } | undefined;
  try {
    fd = fs.openSync(targetPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    const createdStat = fs.fstatSync(fd);
    createdIdentity = { dev: createdStat.dev, ino: createdStat.ino };
    fs.writeFileSync(fd, WORKSPACE_ENV_TEMPLATE, { encoding: 'utf8' });
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    // The restrictive mode was applied atomically by openSync; avoid a path-based chmod
    // after closing the descriptor, which could follow a file swapped in by another process.
    return {
      created: true,
      path: targetPath,
      message: `Created ${targetPath} with restrictive file permissions and empty credential fields. Edit the file, then restart VERTEX and run "vertex doctor".`
    };
  } catch (error) {
    if (fd !== undefined && createdIdentity) {
      try {
        const currentPathStat = fs.lstatSync(targetPath);
        if (!currentPathStat.isSymbolicLink()
          && currentPathStat.isFile()
          && currentPathStat.dev === createdIdentity.dev
          && currentPathStat.ino === createdIdentity.ino) {
          fs.unlinkSync(targetPath);
        }
      } catch {
        // Best-effort cleanup only; never remove a path we cannot verify is ours.
      }
    }
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best-effort cleanup */ }
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return {
        created: false,
        path: targetPath,
        message: `Not changed: ${targetPath} already exists. Existing configuration and credentials were left untouched.`
      };
    }
    throw error;
  }
}

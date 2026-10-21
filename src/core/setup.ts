import * as fs from 'node:fs';
import * as path from 'node:path';

export type WorkspaceInitResult = { created: boolean; path: string; message: string };

export const WORKSPACE_ENV_TEMPLATE = `# VERTEX workspace configuration
# This file may contain credentials. Keep it private and never commit it.
# Get an API key from your provider, then add it below.
OPENAI_API_KEY=
# Optional: custom OpenAI-compatible endpoint. Leave blank to use the SDK default.
OPENAI_BASE_URL=
# Optional: model name. Leave blank to use the runtime default.
AI_MODEL=
# cloud, local, or offline. Use local/offline only after configuring a local model endpoint.
BRAIN_MODE=cloud
# Optional: limit file access to a workspace root. Blank uses the current directory.
VERTEX_WORKSPACE_ROOT=
# Subprocess timeout in milliseconds.
SHELL_TIMEOUT_MS=60000
`;

/**
 * Create a starter .env only when none exists. O_EXCL prevents overwriting existing files
 * and also refuses to follow a pre-existing symlink at the destination.
 */
export function initializeWorkspaceConfig(cwd: string = process.cwd()): WorkspaceInitResult {
  const targetPath = path.join(path.resolve(cwd), '.env');
  let fd: number | undefined;
  let created = false;
  try {
    fd = fs.openSync(targetPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    created = true;
    fs.writeFileSync(fd, WORKSPACE_ENV_TEMPLATE, { encoding: 'utf8' });
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    if (process.platform !== 'win32') fs.chmodSync(targetPath, 0o600);
    return {
      created: true,
      path: targetPath,
      message: `Created ${targetPath} with restrictive file permissions and empty credential fields. Edit the file, then restart VERTEX and run "vertex doctor".`
    };
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best-effort cleanup */ }
    }
    if (created) {
      try { fs.unlinkSync(targetPath); } catch { /* avoid leaving a partial template */ }
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

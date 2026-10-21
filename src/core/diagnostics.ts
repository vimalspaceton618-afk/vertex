import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as dotenv from 'dotenv';

export type DiagnosticStatus = 'pass' | 'warn' | 'fail';
export type DiagnosticItem = { name: string; status: DiagnosticStatus; message: string };
export type DiagnosticReport = {
  items: DiagnosticItem[];
  failedCount: number;
  warningCount: number;
  ok: boolean;
};

export type DiagnosticOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  configPath?: string;
  platform?: NodeJS.Platform;
  checkGit?: boolean;
  checkDocker?: boolean;
};

function checkCommand(command: string, args: string[], cwd: string): boolean {
  try {
    const result = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: 'ignore',
      shell: false,
      timeout: 2500,
      windowsHide: true
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function parseMajor(version: string): number {
  const match = version.replace(/^v/, '').match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

/**
 * Read-only local diagnostics. This function never prints, returns, or logs credential values
 * and never invokes a shell or makes a network request.
 */
export function collectDiagnostics(options: DiagnosticOptions = {}): DiagnosticReport {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const configPath = options.configPath ?? path.join(os.homedir(), '.vertexcli', 'config.json');
  const items: DiagnosticItem[] = [];
  let config: Record<string, unknown> | null = null;

  const add = (name: string, status: DiagnosticStatus, message: string) => {
    items.push({ name, status, message });
  };

  if (parseMajor(nodeVersion) >= 20) {
    add('Node.js', 'pass', `Node.js ${nodeVersion} meets the minimum supported major version (20).`);
  } else {
    add('Node.js', 'fail', `Node.js ${nodeVersion || '(unknown)'} is too old; install Node.js 20 or newer.`);
  }

  try {
    const stat = fs.statSync(cwd);
    if (!stat.isDirectory()) {
      add('Workspace', 'fail', 'The current workspace path is not a directory.');
    } else {
      fs.accessSync(cwd, fs.constants.R_OK | fs.constants.W_OK);
      add('Workspace', 'pass', 'The current workspace exists and is readable and writable.');
    }
  } catch {
    add('Workspace', 'fail', 'The current workspace does not exist or is not readable and writable.');
  }

  try {
    const lstat = fs.lstatSync(configPath);
    if (lstat.isSymbolicLink()) {
      add('Global config', 'fail', 'The global config path is a symbolic link; inspect it before running VERTEX.');
    } else if (!lstat.isFile()) {
      add('Global config', 'fail', 'The global config path exists but is not a regular file.');
    } else {
      fs.accessSync(configPath, fs.constants.R_OK);
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          add('Global config', 'fail', 'The global config must contain a JSON object.');
        } else {
          config = parsed as Record<string, unknown>;
          add('Global config', 'pass', 'The global config exists and contains valid JSON.');
        }
      } catch {
        add('Global config', 'fail', 'The global config is unreadable or contains invalid JSON.');
      }

      if (platform !== 'win32' && (lstat.mode & 0o077) !== 0) {
        add('Config permissions', 'warn', 'The global config is accessible to group/other users; restrict it to the current user (chmod 600).');
      } else if (platform !== 'win32') {
        add('Config permissions', 'pass', 'The global config has user-only filesystem permissions.');
      } else {
        add('Config permissions', 'warn', 'Verify Windows ACLs on the global config directory and file.');
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      add('Global config', 'warn', 'No global config exists yet; VERTEX can initialize one when the app starts.');
    } else {
      add('Global config', 'fail', 'The global config cannot be inspected; check its path and permissions.');
    }
  }

  let workspaceEnv: Record<string, string> = {};
  const workspaceEnvPath = path.join(cwd, '.env');
  try {
    const envStat = fs.lstatSync(workspaceEnvPath);
    if (envStat.isSymbolicLink()) {
      add('Workspace .env', 'warn', 'The workspace .env is a symbolic link and was not read; inspect it before relying on provider settings.');
    } else if (!envStat.isFile()) {
      add('Workspace .env', 'warn', 'The workspace .env path is not a regular file and was not read.');
    } else {
      fs.accessSync(workspaceEnvPath, fs.constants.R_OK);
      workspaceEnv = dotenv.parse(fs.readFileSync(workspaceEnvPath));
      if (platform !== 'win32' && (envStat.mode & 0o077) !== 0) {
        add('Workspace .env permissions', 'warn', 'The workspace .env is accessible to group/other users; restrict it to the current user (chmod 600).');
      } else if (platform !== 'win32') {
        add('Workspace .env permissions', 'pass', 'The workspace .env has user-only filesystem permissions.');
      } else {
        add('Workspace .env permissions', 'warn', 'Verify Windows ACLs on the workspace .env file.');
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      add('Workspace .env', 'warn', 'The workspace .env could not be inspected; check its path and permissions.');
    }
  }

  const configured = (key: string): string => {
    const fromConfig = config?.[key];
    if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
    const fromEnv = env[key];
    if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
    const fromWorkspaceEnv = workspaceEnv[key];
    return typeof fromWorkspaceEnv === 'string' ? fromWorkspaceEnv.trim() : '';
  };
  const mode = (configured('BRAIN_MODE') || 'cloud').toLowerCase();
  const localOnly = ['local', 'local_only', 'local-only', 'offline'].includes(mode);
  const apiKeyConfigured = Boolean(configured('OPENAI_API_KEY'));
  const localModelConfigured = Boolean(configured('LOCAL_MODEL') || configured('AI_MODEL'));
  if (localOnly) {
    if (configured('LOCAL_BASE_URL') && localModelConfigured) {
      add('Model provider', 'pass', 'Local mode has an endpoint and a model identifier configured.');
    } else {
      add('Model provider', 'warn', 'Local mode is selected, but a local endpoint or model identifier may still need configuration.');
    }
  } else if (apiKeyConfigured) {
    add('Model provider', 'pass', 'A cloud-provider API key is configured; the value is never displayed.');
  } else {
    add('Model provider', 'warn', 'No cloud-provider API key was detected; model requests may fail until credentials are configured.');
  }

  const baseUrl = configured('OPENAI_BASE_URL');
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        add('Provider URL', 'warn', 'The configured provider URL has an unsupported scheme or embedded credentials; review it without sharing the URL publicly.');
      } else {
        add('Provider URL', 'pass', 'The configured provider URL uses HTTP(S) and contains no embedded username/password.');
      }
    } catch {
      add('Provider URL', 'warn', 'The configured provider URL is not a valid absolute URL.');
    }
  } else {
    add('Provider URL', 'pass', 'No custom provider URL is set; the SDK default endpoint may be used.');
  }

  if (options.checkGit !== false) {
    if (!checkCommand('git', ['--version'], cwd)) {
      add('Git', 'warn', 'Git is not available on PATH; repository-aware workflows may be limited.');
    } else if (checkCommand('git', ['rev-parse', '--show-toplevel'], cwd)) {
      add('Git', 'pass', 'Git is available and the workspace is inside a repository.');
    } else {
      add('Git', 'warn', 'Git is installed, but the current workspace is not inside a Git repository.');
    }
  }

  if (options.checkDocker !== false) {
    if (checkCommand('docker', ['info', '--format', '{{.ServerVersion}}'], cwd)) {
      add('Docker', 'pass', 'The Docker CLI and local daemon are reachable.');
    } else {
      add('Docker', 'warn', 'Docker daemon is unavailable; sandbox features that require Docker will not work until it is running.');
    }
  }

  const failedCount = items.filter((item) => item.status === 'fail').length;
  const warningCount = items.filter((item) => item.status === 'warn').length;
  return { items, failedCount, warningCount, ok: failedCount === 0 };
}

export function formatDiagnosticReport(report: DiagnosticReport): string {
  const icon: Record<DiagnosticStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
  return [
    'VERTEX Doctor',
    '',
    ...report.items.map((item) => `[${icon[item.status]}] ${item.name}: ${item.message}`),
    '',
    `Summary: ${report.items.length - report.failedCount - report.warningCount} passed, ${report.warningCount} warning(s), ${report.failedCount} failure(s).`,
    report.ok ? 'No blocking environment problems were detected.' : 'Resolve the failures above before relying on VERTEX.'
  ].join('\n');
}

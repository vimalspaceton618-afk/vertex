import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { initializeWorkspaceConfig } from '../dist/core/setup.js';
import { collectDiagnostics, formatDiagnosticReport } from '../dist/core/diagnostics.js';
import { ConfigManager } from '../dist/core/config.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-first-run-'));
}

test('init creates an empty-secret template with restrictive permissions', () => {
  const cwd = makeTempDir();
  try {
    const result = initializeWorkspaceConfig(cwd);
    assert.equal(result.created, true);
    const envFile = path.join(cwd, '.env');
    const contents = fs.readFileSync(envFile, 'utf8');
    assert.match(contents, /OPENAI_API_KEY=\n/);
    assert.match(contents, /never commit it/i);
    assert.match(contents, /LOCAL_BASE_URL=http:\/\/127\.0\.0\.1:11434\/v1/);
    assert.match(contents, /LOCAL_MODEL=/);
    assert.match(contents, /WORKSPACE_ROOT=/);
    assert.doesNotMatch(contents, /^VERTEX_WORKSPACE_ROOT=/m);
    assert.doesNotMatch(contents, /OPENAI_API_KEY=(?!\s*$)[^\n]+/);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('init never overwrites existing credentials or follows an existing .env link', () => {
  const cwd = makeTempDir();
  try {
    const envFile = path.join(cwd, '.env');
    fs.writeFileSync(envFile, 'OPENAI_API_KEY=keep-this-private\n', { mode: 0o600 });
    const first = initializeWorkspaceConfig(cwd);
    assert.equal(first.created, false);
    assert.equal(fs.readFileSync(envFile, 'utf8'), 'OPENAI_API_KEY=keep-this-private\n');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('init refuses to follow a pre-existing .env symlink', (t) => {
  const cwd = makeTempDir();
  const outside = makeTempDir();
  const target = path.join(outside, 'protected.env');
  const envFile = path.join(cwd, '.env');
  const original = 'OPENAI_API_KEY=do-not-change\\n';
  try {
    fs.writeFileSync(target, original, { mode: 0o600 });
    try {
      fs.symlinkSync(target, envFile);
    } catch {
      t.skip('Symlink creation is unavailable on this platform.');
      return;
    }
    const result = initializeWorkspaceConfig(cwd);
    assert.equal(result.created, false);
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    assert.equal(fs.lstatSync(envFile).isSymbolicLink(), true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('doctor reports environment state without exposing credential values', () => {
  const cwd = makeTempDir();
  const configPath = path.join(cwd, 'config.json');
  const secret = 'never-print-this-token-123';
  try {
    fs.writeFileSync(configPath, JSON.stringify({ OPENAI_API_KEY: secret, BRAIN_MODE: 'cloud' }), { mode: 0o600 });
    const report = collectDiagnostics({
      cwd,
      configPath,
      env: { OPENAI_API_KEY: secret, BRAIN_MODE: 'cloud', AI_MODEL: 'test-model' },
      nodeVersion: '22.1.0',
      platform: 'linux',
      checkGit: false,
      checkDocker: false
    });
    const text = formatDiagnosticReport(report);
    assert.equal(report.ok, true);
    assert.match(text, /\[PASS\] Node\.js/);
    assert.match(text, /Model provider.*configured/i);
    assert.doesNotMatch(text, new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctor detects old Node.js, unsafe config permissions, and invalid JSON', () => {
  const cwd = makeTempDir();
  const configPath = path.join(cwd, 'config.json');
  try {
    fs.writeFileSync(configPath, '{invalid-json}', { mode: 0o644 });
    if (process.platform !== 'win32') fs.chmodSync(configPath, 0o644);
    const report = collectDiagnostics({
      cwd,
      configPath,
      env: {},
      nodeVersion: '18.19.0',
      platform: process.platform,
      checkGit: false,
      checkDocker: false
    });
    assert.equal(report.ok, false);
    assert.ok(report.items.some((item) => item.name === 'Node.js' && item.status === 'fail'));
    assert.ok(report.items.some((item) => item.name === 'Global config' && item.status === 'fail'));
    if (process.platform !== 'win32') {
      assert.ok(report.items.some((item) => item.name === 'Config permissions' && item.status === 'warn'));
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctor warns when workspace .env permissions expose the file to other users', () => {
  const cwd = makeTempDir();
  const envPath = path.join(cwd, '.env');
  try {
    fs.writeFileSync(envPath, 'OPENAI_API_KEY=placeholder\n', { mode: 0o644 });
    if (process.platform !== 'win32') fs.chmodSync(envPath, 0o644);
    const report = collectDiagnostics({
      cwd,
      configPath: path.join(cwd, 'missing-config.json'),
      env: {},
      nodeVersion: '22.1.0',
      platform: process.platform,
      checkGit: false,
      checkDocker: false
    });
    if (process.platform !== 'win32') {
      assert.ok(report.items.some((item) => item.name === 'Workspace .env permissions' && item.status === 'warn'));
    } else {
      assert.ok(report.items.some((item) => item.name === 'Workspace .env permissions' && item.status === 'warn'));
    }
    assert.doesNotMatch(JSON.stringify(report), /placeholder/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctor reads regular workspace .env files but refuses to follow symlinks', () => {
  const cwd = makeTempDir();
  const outside = makeTempDir();
  const secret = 'workspace-secret-never-display';
  try {
    const envFile = path.join(cwd, '.env');
    fs.writeFileSync(envFile, `OPENAI_API_KEY=${secret}\\nBRAIN_MODE=cloud\\n`, { mode: 0o600 });
    const regularReport = collectDiagnostics({
      cwd,
      configPath: path.join(cwd, 'missing-config.json'),
      env: {},
      nodeVersion: '22.1.0',
      platform: process.platform,
      checkGit: false,
      checkDocker: false
    });
    assert.ok(regularReport.items.some((item) => item.name === 'Model provider' && item.status === 'pass'));
    assert.doesNotMatch(JSON.stringify(regularReport), new RegExp(secret));

    fs.rmSync(envFile);
    fs.writeFileSync(path.join(outside, 'foreign.env'), `OPENAI_API_KEY=${secret}\\n`, { mode: 0o600 });
    try {
      fs.symlinkSync(path.join(outside, 'foreign.env'), envFile);
    } catch {
      return; // Symlink creation may be unavailable on some Windows runners.
    }
    const linkedReport = collectDiagnostics({
      cwd,
      configPath: path.join(cwd, 'missing-config.json'),
      env: {},
      nodeVersion: '22.1.0',
      platform: process.platform,
      checkGit: false,
      checkDocker: false
    });
    assert.ok(linkedReport.items.some((item) => item.name === 'Workspace .env' && item.status === 'warn'));
    assert.ok(linkedReport.items.some((item) => item.name === 'Model provider' && item.status === 'warn'));
    assert.doesNotMatch(JSON.stringify(linkedReport), new RegExp(secret));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('doctor validates local provider URLs and never echoes embedded credentials', () => {
  const cwd = makeTempDir();
  const configPath = path.join(cwd, 'config.json');
  const privateUrl = 'https://private-user:private-password@example.invalid/v1';
  try {
    fs.writeFileSync(configPath, JSON.stringify({ BRAIN_MODE: 'local', LOCAL_BASE_URL: 'file:///tmp/model', LOCAL_MODEL: 'test-model' }), { mode: 0o600 });
    const report = collectDiagnostics({
      cwd,
      configPath,
      env: { OPENAI_BASE_URL: privateUrl },
      nodeVersion: '22.1.0',
      platform: process.platform,
      checkGit: false,
      checkDocker: false
    });
    const serialized = JSON.stringify(report);
    assert.ok(report.items.some((item) => item.name === 'Local provider URL' && item.status === 'warn'));
    assert.ok(report.items.some((item) => item.name === 'Model provider' && item.status === 'warn'), 'invalid local endpoints must not be reported as ready');
    assert.ok(report.items.some((item) => item.name === 'Cloud provider URL' && item.status === 'warn'));
    assert.doesNotMatch(serialized, /private-user|private-password|private\.invalid/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('normal startup refuses to load secrets through a symlinked workspace .env', (t) => {
  const root = makeTempDir();
  const outside = makeTempDir();
  const originalCwd = process.cwd();
  const key = 'VERTEX_TEST_PRIVATE_ENV';
  const previousValue = process.env[key];
  const envFile = path.join(root, '.env');
  try {
    fs.writeFileSync(path.join(outside, 'foreign.env'), `${key}=must-not-load\\n`, { mode: 0o600 });
    try {
      fs.symlinkSync(path.join(outside, 'foreign.env'), envFile);
    } catch {
      t.skip('Symlink creation is unavailable on this platform.');
      return;
    }
    delete process.env[key];
    process.chdir(root);
    assert.throws(() => ConfigManager.init(), /workspace \.env.*symbolic link/i);
    assert.equal(process.env[key], undefined, 'secret-like values from a symlink target must not enter process.env');
  } finally {
    process.chdir(originalCwd);
    if (previousValue === undefined) delete process.env[key];
    else process.env[key] = previousValue;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('global config initialization refuses to follow a symlink', (t) => {
  const root = makeTempDir();
  const configDir = path.join(root, '.vertexcli');
  const target = path.join(root, 'outside-config.json');
  const link = path.join(configDir, 'config.json');
  const previousPath = ConfigManager.globalConfigPath;
  const original = JSON.stringify({ marker: 'must-remain-unchanged' });
  try {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, original, { mode: 0o600 });
    try {
      fs.symlinkSync(target, link);
    } catch {
      t.skip('Symlink creation is unavailable on this platform.');
      return;
    }
    ConfigManager.globalConfigPath = link;
    assert.throws(() => ConfigManager.init(), /symbolic link/i);
    assert.equal(fs.readFileSync(target, 'utf8'), original, 'symlink target must remain unchanged');
  } finally {
    ConfigManager.globalConfigPath = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('global config initialization refuses to traverse a symlinked config directory', (t) => {
  const root = makeTempDir();
  const outside = makeTempDir();
  const linkedDir = path.join(root, '.vertexcli');
  const previousPath = ConfigManager.globalConfigPath;
  try {
    try {
      fs.symlinkSync(outside, linkedDir, 'dir');
    } catch {
      t.skip('Symlink creation is unavailable on this platform.');
      return;
    }
    ConfigManager.globalConfigPath = path.join(linkedDir, 'config.json');
    assert.throws(() => ConfigManager.init(), /symbolic link/i);
    assert.equal(fs.existsSync(path.join(outside, 'config.json')), false, 'the linked directory must not receive a config file');
  } finally {
    ConfigManager.globalConfigPath = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('CLI doctor and init run without hidden config or scope writes', () => {
  const root = makeTempDir();
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const env = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    APPDATA: root,
    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: '',
    BRAIN_MODE: 'cloud'
  };
  try {
    const doctor = spawnSync(process.execPath, [cliPath, 'doctor', '--json'], {
      cwd: workspace,
      env,
      encoding: 'utf8',
      timeout: 15000
    });
    assert.equal(doctor.error, undefined, doctor.error?.message);
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.ok(Array.isArray(report.items));
    assert.equal(fs.existsSync(path.join(root, '.vertexcli')), false, 'doctor must not initialize global config');
    assert.equal(fs.existsSync(path.join(workspace, '.vertex')), false, 'doctor must not create workspace policy state');

    const init = spawnSync(process.execPath, [cliPath, 'init'], {
      cwd: workspace,
      env,
      encoding: 'utf8',
      timeout: 15000
    });
    assert.equal(init.error, undefined, init.error?.message);
    assert.equal(init.status, 0, init.stderr);
    assert.ok(fs.existsSync(path.join(workspace, '.env')), 'init should create the local template');
    assert.equal(fs.existsSync(path.join(root, '.vertexcli')), false, 'init must not initialize global config as a side effect');
    assert.equal(fs.existsSync(path.join(workspace, '.vertex')), false, 'init must not create workspace policy state');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(workspace, '.env')).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

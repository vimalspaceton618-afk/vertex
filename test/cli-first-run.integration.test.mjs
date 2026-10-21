import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-cli-smoke-'));
}

function runCli(args, cwd, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_MODEL', 'BRAIN_MODE', 'LOCAL_MODEL', 'LOCAL_BASE_URL', 'WORKSPACE_ROOT', 'VERTEX_WORKSPACE_ROOT']) {
    delete env[key];
  }
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 10000,
    shell: false,
    windowsHide: true
  });
}

test('CLI init is idempotent and does not initialize global runtime state', () => {
  const workspace = makeTempDir();
  const home = makeTempDir();
  try {
    const first = runCli(['init'], workspace, home);
    assert.equal(first.error, undefined, first.error?.message);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Created .*\.env/);
    const envPath = path.join(workspace, '.env');
    const initial = fs.readFileSync(envPath, 'utf8');
    assert.match(initial, /^OPENAI_API_KEY=$/m);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
    }

    fs.writeFileSync(envPath, 'OPENAI_API_KEY=preserve-existing-value\n', { mode: 0o600 });
    const second = runCli(['init'], workspace, home);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /already exists/i);
    assert.equal(fs.readFileSync(envPath, 'utf8'), 'OPENAI_API_KEY=preserve-existing-value\n');
    assert.equal(fs.existsSync(path.join(home, '.vertexcli', 'config.json')), false,
      'init must not initialize global agent runtime configuration');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI doctor --json is parseable, redacts secrets, and has no agent-startup side effects', () => {
  const workspace = makeTempDir();
  const home = makeTempDir();
  const secret = 'cli-smoke-secret-should-never-print';
  try {
    fs.writeFileSync(path.join(workspace, '.env'), 'OPENAI_API_KEY=' + secret + '\n', { mode: 0o600 });
    const result = runCli(['doctor', '--json'], workspace, home);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.ok(Array.isArray(report.items), 'doctor JSON should expose diagnostic items');
    assert.ok(report.items.some((item) => item.name === 'Model provider' && item.status === 'pass'));
    assert.doesNotMatch(result.stdout, new RegExp(secret));
    assert.equal(fs.existsSync(path.join(home, '.vertexcli', 'config.json')), false,
      'doctor must not create global config or start an agent task');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI doctor does not echo credentials embedded in provider URLs', () => {
  const workspace = makeTempDir();
  const home = makeTempDir();
  const user = 'private-cli-user';
  const password = 'private-cli-password';
  try {
    fs.writeFileSync(path.join(workspace, '.env'),
      'OPENAI_BASE_URL=https://' + user + ':' + password + '@example.invalid/v1\n',
      { mode: 0o600 });
    const result = runCli(['doctor', '--json'], workspace, home);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(report.items.some((item) => item.name === 'Cloud provider URL' && item.status === 'warn'));
    assert.doesNotMatch(result.stdout, /private-cli-user|private-cli-password|example\.invalid/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI init refuses a symlinked .env and preserves the link target', (t) => {
  const workspace = makeTempDir();
  const home = makeTempDir();
  const outside = makeTempDir();
  const envPath = path.join(workspace, '.env');
  const target = path.join(outside, 'credentials.env');
  const original = 'OPENAI_API_KEY=do-not-touch-this\n';
  try {
    fs.writeFileSync(target, original, { mode: 0o600 });
    try {
      fs.symlinkSync(target, envPath);
    } catch {
      t.skip('Symlink creation is unavailable on this platform.');
      return;
    }
    const result = runCli(['init'], workspace, home);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Not changed: .*already exists/i);
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    assert.equal(fs.lstatSync(envPath).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(home, '.vertexcli', 'config.json')), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('CLI doctor warns on a symlinked workspace .env without reading its secret', (t) => {
  const workspace = makeTempDir();
  const home = makeTempDir();
  const outside = makeTempDir();
  const envPath = path.join(workspace, '.env');
  const secret = 'symlink-secret-must-not-load';
  try {
    fs.writeFileSync(path.join(outside, 'foreign.env'), 'OPENAI_API_KEY=' + secret + '\n', { mode: 0o600 });
    try {
      fs.symlinkSync(path.join(outside, 'foreign.env'), envPath);
    } catch {
      t.skip('Symlink creation is unavailable on this platform.');
      return;
    }
    const result = runCli(['doctor', '--json'], workspace, home);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(report.items.some((item) => item.name === 'Workspace .env' && item.status === 'warn'));
    assert.ok(report.items.some((item) => item.name === 'Model provider' && item.status === 'warn'));
    assert.doesNotMatch(result.stdout, new RegExp(secret));
    assert.equal(fs.existsSync(path.join(home, '.vertexcli', 'config.json')), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

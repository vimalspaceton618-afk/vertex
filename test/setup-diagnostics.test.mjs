import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initializeWorkspaceConfig, WORKSPACE_ENV_TEMPLATE } from '../dist/core/setup.js';
import { collectDiagnostics, formatDiagnosticReport } from '../dist/core/diagnostics.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-day2-'));
}

test('vertex init creates a private template with empty credentials', () => {
  const cwd = tempDir();
  try {
    const result = initializeWorkspaceConfig(cwd);
    const envPath = path.join(cwd, '.env');
    assert.equal(result.created, true);
    assert.equal(result.path, envPath);
    assert.equal(fs.readFileSync(envPath, 'utf8'), WORKSPACE_ENV_TEMPLATE);
    assert.match(fs.readFileSync(envPath, 'utf8'), /^OPENAI_API_KEY=$/m);
    assert.match(fs.readFileSync(envPath, 'utf8'), /^LOCAL_BASE_URL=http:\/\/127\.0\.0\.1:11434\/v1$/m);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('vertex init never overwrites existing workspace credentials', () => {
  const cwd = tempDir();
  const envPath = path.join(cwd, '.env');
  const original = 'OPENAI_API_KEY=do-not-touch\n';
  try {
    fs.writeFileSync(envPath, original, { mode: 0o600 });
    const result = initializeWorkspaceConfig(cwd);
    assert.equal(result.created, false);
    assert.equal(fs.readFileSync(envPath, 'utf8'), original);
    assert.match(result.message, /already exists/i);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('vertex init refuses to follow a pre-existing .env symlink', (t) => {
  const cwd = tempDir();
  const outside = tempDir();
  const envPath = path.join(cwd, '.env');
  const target = path.join(outside, 'keep.txt');
  try {
    fs.writeFileSync(target, 'outside sentinel');
    try {
      fs.symlinkSync(target, envPath, 'file');
    } catch (error) {
      t.skip(`symlinks unavailable in this environment: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const result = initializeWorkspaceConfig(cwd);
    assert.equal(result.created, false);
    assert.equal(fs.readFileSync(target, 'utf8'), 'outside sentinel');
    assert.equal(fs.lstatSync(envPath).isSymbolicLink(), true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('doctor reports configuration state without exposing secret values', () => {
  const cwd = tempDir();
  const configPath = path.join(cwd, 'global-config.json');
  const secret = 'sk-test-DO-NOT-LEAK-91f6';
  try {
    fs.writeFileSync(path.join(cwd, '.env'), `OPENAI_API_KEY=${secret}\nOPENAI_BASE_URL=https://api.example.test/v1\n`, { mode: 0o600 });
    fs.writeFileSync(configPath, JSON.stringify({ OPENAI_API_KEY: secret }), { mode: 0o600 });
    const report = collectDiagnostics({
      cwd,
      configPath,
      env: {},
      nodeVersion: 'v22.0.0',
      checkGit: false,
      checkDocker: false
    });
    const output = JSON.stringify(report) + formatDiagnosticReport(report);
    assert.match(output, /Model provider/);
    assert.match(output, /Provider URL/);
    assert.doesNotMatch(output, new RegExp(secret));
    assert.equal(report.items.some((item) => item.name === 'Node.js' && item.status === 'pass'), true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctor warns on an invalid custom provider URL without echoing it', () => {
  const cwd = tempDir();
  const configPath = path.join(cwd, 'global-config.json');
  const unsafeUrl = 'file:///tmp/private-path';
  try {
    fs.writeFileSync(configPath, JSON.stringify({ OPENAI_BASE_URL: unsafeUrl }), { mode: 0o600 });
    const report = collectDiagnostics({
      cwd,
      configPath,
      env: {},
      nodeVersion: 'v22.0.0',
      checkGit: false,
      checkDocker: false
    });
    const providerUrl = report.items.find((item) => item.name === 'Provider URL');
    assert.equal(providerUrl?.status, 'warn');
    assert.doesNotMatch(JSON.stringify(report), new RegExp(unsafeUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

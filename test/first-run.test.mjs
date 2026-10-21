import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initializeWorkspaceConfig } from '../dist/core/setup.js';
import { collectDiagnostics, formatDiagnosticReport } from '../dist/core/diagnostics.js';

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
    assert.match(text, /Node\.js.*PASS/);
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

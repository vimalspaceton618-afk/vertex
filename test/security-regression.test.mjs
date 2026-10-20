import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateRemoteTarget } from '../dist/tools/AutoExecutor.js';
import { evaluateToolPolicy } from '../dist/core/policy/PolicyEngine.js';
import { resolveInsideWorkspace } from '../dist/tools/PathSecurity.js';
import { isAllowedDaemonOrigin } from '../dist/core/daemon.js';
import { toGraphQLStringLiteral } from '../dist/tools/CloudCompute.js';

test('remote SSH target validation rejects shell metacharacters in host and username', () => {
  assert.match(validateRemoteTarget('example.com;whoami', 'vimal') ?? '', /Invalid SSH host/);
  assert.match(validateRemoteTarget('example.com', 'vimal;whoami') ?? '', /Invalid SSH username/);
  assert.match(validateRemoteTarget('-oProxyCommand=evil', 'vimal') ?? '', /Invalid SSH host/);
});

test('remote SSH target validation accepts ordinary DNS names and IP addresses', () => {
  assert.equal(validateRemoteTarget('example.com', 'deploy'), null);
  assert.equal(validateRemoteTarget('192.168.1.20', 'deploy'), null);
  assert.equal(validateRemoteTarget('[::1]', 'deploy'), null);
});

test('unrestricted lab mode does not override explicit blocked targets', () => {
  const previousRoot = process.env.VERTEX_WORKSPACE_ROOT;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-policy-test-'));
  try {
    process.env.VERTEX_WORKSPACE_ROOT = tempRoot;
    fs.mkdirSync(path.join(tempRoot, '.vertex'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, '.vertex', 'scope.json'), JSON.stringify({
      mode: 'unrestricted_lab',
      localOnly: false,
      allowedDomains: [],
      allowedCidrs: [],
      blockedTargets: ['example.com'],
      allowedOffensiveTools: []
    }));

    const blocked = evaluateToolPolicy({
      toolName: 'test_tool',
      riskLevel: 'read',
      targets: ['api.example.com']
    });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /blocked by scope policy/i);

    const allowed = evaluateToolPolicy({
      toolName: 'test_tool',
      riskLevel: 'read',
      targets: ['safe.example.net']
    });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.requiresConfirmation, false);
  } finally {
    if (previousRoot === undefined) delete process.env.VERTEX_WORKSPACE_ROOT;
    else process.env.VERTEX_WORKSPACE_ROOT = previousRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('workspace path resolver rejects traversal and symlink escapes', () => {
  const previousRoot = process.env.VERTEX_WORKSPACE_ROOT;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-workspace-test-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-outside-test-'));
  try {
    process.env.VERTEX_WORKSPACE_ROOT = workspace;
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside workspace');
    fs.symlinkSync(outside, path.join(workspace, 'outside-link'), 'dir');

    assert.throws(() => resolveInsideWorkspace('../outside/secret.txt'), /escapes workspace root/i);
    assert.throws(() => resolveInsideWorkspace(path.join(outside, 'secret.txt')), /escapes workspace root/i);
    assert.throws(() => resolveInsideWorkspace('outside-link/secret.txt'), /escapes workspace root/i);
    assert.throws(() => resolveInsideWorkspace('outside-link/not-created/nested/file.txt'), /escapes workspace root/i);
  } finally {
    if (previousRoot === undefined) delete process.env.VERTEX_WORKSPACE_ROOT;
    else process.env.VERTEX_WORKSPACE_ROOT = previousRoot;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('daemon only accepts browser origins on loopback hosts', () => {
  assert.equal(isAllowedDaemonOrigin('http://127.0.0.1:8899'), true);
  assert.equal(isAllowedDaemonOrigin('http://localhost:8899'), true);
  assert.equal(isAllowedDaemonOrigin('https://example.com'), false);
  assert.equal(isAllowedDaemonOrigin('null'), false);
  assert.equal(isAllowedDaemonOrigin('http://localhost.evil.example'), false);
});

test('GraphQL string literal encoding preserves content without raw line breaks', () => {
  const input = 'image"\\nmutation { admin }\\\\';
  const encoded = toGraphQLStringLiteral(input);
  assert.equal(JSON.parse(encoded), input);
  assert.equal(encoded.includes('\n'), false);
});


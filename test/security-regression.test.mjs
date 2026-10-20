import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateRemoteTarget } from '../dist/tools/AutoExecutor.js';
import { evaluateToolPolicy } from '../dist/core/policy/PolicyEngine.js';

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

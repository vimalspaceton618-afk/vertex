import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SharedContext } from '../dist/core/agent/SharedContext.js';

test('shared state directory and file use restrictive POSIX permissions', { skip: process.platform === 'win32' }, () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-state-permissions-'));
  const previousRoot = process.env.VERTEX_WORKSPACE_ROOT;

  try {
    process.env.VERTEX_WORKSPACE_ROOT = workspace;
    SharedContext.init();
    const stateFile = path.join(workspace, '.vertex', 'state.json');
    assert.equal(fs.statSync(path.dirname(stateFile)).mode & 0o777, 0o700, 'state directory should be owner-only');
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600, 'new state file should be owner-readable/writable only');

    // Existing files must also be hardened, not just newly created files.
    fs.chmodSync(stateFile, 0o644);
    SharedContext.set('permissionTest', { ok: true });
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600, 'updated state file should be owner-only');
    assert.deepEqual(SharedContext.get('permissionTest'), { ok: true });
  } finally {
    if (previousRoot === undefined) delete process.env.VERTEX_WORKSPACE_ROOT;
    else process.env.VERTEX_WORKSPACE_ROOT = previousRoot;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('npm package exposes a buildable global vertex executable', () => {
  assert.equal(packageJson.bin?.vertex, './dist/cli.js');
  assert.ok(packageJson.files?.includes('dist/**'), 'published package must include compiled dist output');
  assert.equal(packageJson.scripts?.prepare, 'npm run build', 'install/pack lifecycle should build the CLI');
  assert.equal(packageJson.engines?.node, '>=22');

  const entrypoint = path.resolve(root, packageJson.bin.vertex);
  const source = fs.readFileSync(entrypoint, 'utf8');
  assert.match(source, /^#!\/usr\/bin\/env node\n/, 'compiled executable must retain its Node.js shebang');

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-bin-smoke-'));
  try {
    const result = spawnSync(process.execPath, [entrypoint, '--version'], {
      cwd,
      encoding: 'utf8',
      timeout: 10_000
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/, 'version command should run outside the repository directory');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

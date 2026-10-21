import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cliPath = path.join(root, 'dist', 'cli.js');
const cliSource = fs.readFileSync(path.join(root, 'src', 'cli.tsx'), 'utf8');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-launch-regression-'));
}

function runCli(args, cwd, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'AI_MODEL',
    'BRAIN_MODE',
    'LOCAL_MODEL',
    'LOCAL_BASE_URL',
    'WORKSPACE_ROOT',
    'VERTEX_WORKSPACE_ROOT'
  ]) {
    delete env[key];
  }

  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 10_000,
    shell: false,
    windowsHide: true
  });
}

test('global CLI help works outside the repository without initializing user state', () => {
  const cwd = makeTempDir();
  const home = makeTempDir();

  try {
    const result = runCli(['--help'], cwd, home);

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: vertex/i);
    assert.match(result.stdout, /doctor/i);
    assert.match(result.stdout, /init/i);
    assert.equal(
      fs.existsSync(path.join(home, '.vertexcli', 'config.json')),
      false,
      '--help must exit before normal runtime initialization'
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('no-argument launch remains wired to the interactive Ink UI', () => {
  const parseIndex = cliSource.indexOf('program.parse(process.argv)');
  const normalStartupIndex = cliSource.indexOf('if (!commandHandled) {');
  const interactiveBranchIndex = cliSource.indexOf("import('./ui.js')");

  assert.ok(parseIndex >= 0, 'Commander must parse CLI arguments');
  assert.ok(
    normalStartupIndex > parseIndex,
    'subcommands must be parsed before normal runtime initialization'
  );
  assert.ok(
    interactiveBranchIndex > normalStartupIndex,
    'the default launch branch must remain after command handling'
  );
  assert.match(
    cliSource,
    /else\s*\{\s*import\('\.\/ui\.js'\)\.then\(\(\{ default: App \}\) => \{\s*const \{ waitUntilExit \} = render\(<App \/>\);\s*return waitUntilExit\(\);\s*\}\)/,
    'no-argument launch must render the interactive UI and wait for its exit'
  );
});

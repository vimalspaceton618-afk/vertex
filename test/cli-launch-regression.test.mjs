import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cliPath = path.join(root, 'dist', 'cli.js');
const cliSource = fs.readFileSync(path.join(root, 'src', 'cli.tsx'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'src', 'ui.tsx'), 'utf8');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-launch-regression-'));
}

function cleanEnv(home) {
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
  return env;
}

function runCli(args, cwd, home) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: cleanEnv(home),
    encoding: 'utf8',
    timeout: 10_000,
    shell: false,
    windowsHide: true
  });
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
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

test('no-argument launch renders the TUI, runs /help, and exits cleanly', async () => {
  const cwd = makeTempDir();
  const home = makeTempDir();
  const env = cleanEnv(home);
  env.MOCK_TTY = '1';
  env.TERM = 'xterm-256color';

  const child = spawn(process.execPath, [cliPath], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true
  });

  let stdout = '';
  let stderr = '';
  let acceptedTrust = false;
  let requestedHelp = false;
  let requestedExit = false;

  try {
    const exitCode = await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(reject, new Error(
          'TUI smoke test timed out. stdout: ' + stripAnsi(stdout).slice(-1800) +
          '\nstderr: ' + stderr.slice(-1000)
        ));
      }, 12_000);

      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };

      const inspectOutput = () => {
        const visible = stripAnsi(stdout);
        if (!acceptedTrust && visible.includes('VERTEX ISOLATION WARNING')) {
          acceptedTrust = true;
          child.stdin.write('1');
        }
        if (acceptedTrust && !requestedHelp && visible.includes('Welcome to VERTEX')) {
          requestedHelp = true;
          child.stdin.write('/help\r');
        }
        if (requestedHelp && !requestedExit && visible.includes('VERTEX COMMANDS')) {
          requestedExit = true;
          child.stdin.write('/exit\r');
        }
      };

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        inspectOutput();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => settle(reject, error));
      child.on('close', (code, signal) => {
        if (code !== 0 || !acceptedTrust || !requestedHelp || !requestedExit) {
          settle(reject, new Error(
            `TUI did not complete cleanly (code=${code}, signal=${signal}, trust=${acceptedTrust}, help=${requestedHelp}, exit=${requestedExit}).\n` +
            'stdout: ' + stripAnsi(stdout).slice(-1800) + '\nstderr: ' + stderr.slice(-1000)
          ));
          return;
        }
        settle(resolve, code);
      });
    });

    const visible = stripAnsi(stdout);
    assert.equal(exitCode, 0);
    assert.match(visible, /VERTEX ISOLATION WARNING/);
    assert.match(visible, /Welcome to VERTEX/);
    assert.match(visible, /VERTEX COMMANDS/);
    assert.match(visible, /\/gpu/);
    assert.match(visible, /Tip: type \/ followed by a few letters/);

    const registry = uiSource.match(/const COMMANDS = \[([\s\S]*?)\n\];/);
    assert.ok(registry, 'the interactive UI command registry exists');
    const commandNames = [...registry[1].matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]);
    assert.ok(commandNames.length >= 20, 'the TUI should expose the expected broad command set');
    assert.equal(new Set(commandNames).size, commandNames.length, 'TUI command names should be unique');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
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

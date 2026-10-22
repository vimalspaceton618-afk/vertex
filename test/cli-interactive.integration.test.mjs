import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cliPath = path.join(root, 'dist', 'cli.js');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function waitForOutput(child, getOutput, needle, timeoutMs = 10_000, startIndex = 0, getErrorOutput = () => '') {
  if (getOutput().slice(startIndex).includes(needle)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const fail = (message) => {
      cleanup();
      reject(new Error(message));
    };
    const onData = () => {
      if (getOutput().slice(startIndex).includes(needle)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code, signal) => {
      fail(`CLI exited before ${JSON.stringify(needle)} (code=${code}, signal=${signal}). Stdout tail: ${getOutput().slice(-500)}. Stderr tail: ${getErrorOutput().slice(-1000)}`);
    };
    const onError = (error) => fail(`CLI failed to start: ${error.message}`);
    const timer = setTimeout(() => {
      fail(`Timed out waiting for ${JSON.stringify(needle)}. Output tail: ${getOutput().slice(-500)}`);
    }, timeoutMs);

    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('CLI did not exit after /exit was submitted.'));
    }, timeoutMs);
    const onExit = (code) => {
      clearTimeout(timer);
      resolve(code);
    };
    child.once('exit', onExit);
  });
}

test('no-argument CLI renders the interactive TUI, opens help, and exits cleanly', {
  timeout: 45_000
}, async (t) => {
  const cwd = makeTempDir('vertex-tui-work-');
  const home = makeTempDir('vertex-tui-home-');
  const env = {
    ...process.env,
    MOCK_TTY: '1',
    HOME: home,
    USERPROFILE: home,
    TERM: 'xterm-256color',
    FORCE_COLOR: '0',
    CI: 'false',
    VERTEX_WORKSPACE_ROOT: cwd
  };

  for (const key of [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'AI_MODEL',
    'BRAIN_MODE',
    'LOCAL_MODEL',
    'LOCAL_BASE_URL',
    'WORKSPACE_ROOT'
  ]) {
    delete env[key];
  }

  const child = spawn(process.execPath, [cliPath], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  await waitForOutput(child, () => stdout, 'Trust this workspace', 10_000, 0, () => stderr);
  child.stdin.write('1');
  await waitForOutput(child, () => stdout, 'Welcome to VERTEX');

  child.stdin.write('/help\r');
  await waitForOutput(child, () => stdout, 'VERTEX COMMANDS');

  for (const command of ['/health', '/doctor', '/init', '/scope', '/sandbox', '/safe-sandbox', '/audit', '/search', '/gpu', '/skill']) {
    assert.ok(stdout.includes(command), `interactive help should list ${command}`);
  }


  const safeCommands = [
    ['/health', 'VERTEX Health Check'],
    ['/doctor', 'VERTEX Doctor'],
    ['/scope', 'Scope file:'],
    ['/init', 'Created '],
    ['/loot stats', '[LOOT STORE STATS]'],
    ['/attack-graph', '[ATTACK GRAPH'],
    ['/gpu', 'GPU Commands:'],
    ['/gpu logs', 'Usage: /gpu logs <instanceId>'],
    ['/gpu destroy', 'Usage: /gpu destroy <instanceId>'],
    ['/gpu deploy', 'Usage: /gpu deploy <script>'],
    ['/schedule x /health', 'Usage: /schedule <seconds> <command>'],
    ['/skill invalid sample', 'Unknown skill: invalid']
  ];
  for (const [command, expected] of safeCommands) {
    const before = stdout.length;
    child.stdin.write(command + String.fromCharCode(13));
    await waitForOutput(child, () => stdout, expected, 8_000, before);
  }

  const missingArguments = [
    ['/phantom', 'Usage: /phantom <red team prompt>'],
    ['/recon', 'Usage: /recon <target>'],
    ['/nyx', 'Usage: /nyx <offensive security prompt>'],
    ['/search', 'Usage: /search <query>'],
    ['/open', 'Usage: /open <url>'],
    ['/summarize-url', 'Usage: /summarize-url <url>'],
    ['/screenshot-url', 'Usage: /screenshot-url <url> [filePath]'],
    ['/goal', 'Usage: /goal <objective>'],
    ['/schedule', 'Usage: /schedule <seconds> <command>'],
    ['/skill', 'Usage: /skill <ncbi|uniprot|pubchem|pubmed|arxiv> <query>'],
    ['/safe-sandbox', 'Usage: /safe-sandbox'],
    ['/sandbox', 'Usage: /sandbox <shell command>']
  ];
  for (const [command, expected] of missingArguments) {
    const before = stdout.length;
    child.stdin.write(command + String.fromCharCode(13));
    await waitForOutput(child, () => stdout, expected, 8_000, before);
  }

  assert.equal(fs.existsSync(path.join(cwd, '.env')), true, '/init should create only the temporary workspace template');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(cwd, '.env')).mode & 0o777, 0o600, '/init must use restrictive permissions');
  }

  child.stdin.write('/exit\r');
  assert.equal(await waitForExit(child), 0, stderr);
});

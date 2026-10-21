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

function waitForOutput(child, getOutput, needle, timeoutMs = 10_000) {
  if (getOutput().includes(needle)) return Promise.resolve();

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
      if (getOutput().includes(needle)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code, signal) => {
      fail(`CLI exited before ${JSON.stringify(needle)} (code=${code}, signal=${signal}). Output tail: ${getOutput().slice(-500)}`);
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
  timeout: 25_000
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

  await waitForOutput(child, () => stdout, 'Trust this workspace');
  child.stdin.write('1');
  await waitForOutput(child, () => stdout, 'Welcome to VERTEX');

  child.stdin.write('/help\r');
  await waitForOutput(child, () => stdout, 'VERTEX COMMANDS');

  for (const command of ['/health', '/doctor', '/init', '/scope', '/sandbox', '/safe-sandbox', '/audit', '/search', '/gpu', '/skill']) {
    assert.ok(stdout.includes(command), `interactive help should list ${command}`);
  }

  child.stdin.write('/exit\r');
  assert.equal(await waitForExit(child), 0, stderr);
});

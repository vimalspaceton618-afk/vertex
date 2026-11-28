import test from 'node:test';
import { attachmentProvider } from './attachment-provider-fixture.mjs';
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
  const matches = () => typeof needle === 'string'
    ? getOutput().slice(startIndex).includes(needle)
    : needle.test(getOutput().slice(startIndex));
  if (matches()) return Promise.resolve();

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
      if (matches()) {
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
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);

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

test('interactive CLI handles commands, repeated clears, multiline drafts and file attachments', {
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
    'WORKSPACE_ROOT',
    'VERTEX_UI_THEME',
    'VERTEX_UI_ASCII'
  ]) {
    delete env[key];
  }

  const provider = await attachmentProvider(t);
  Object.assign(env, {
    OPENAI_BASE_URL: provider.url, LOCAL_BASE_URL: provider.url, OPENAI_API_KEY: 'fixture',
    BRAIN_MODE: 'cloud', AI_MODEL: 'text-fixture', VISION_MODEL: 'vision-fixture',
  });

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

  t.after(async () => {
    // Stop the spawned TUI and wait for Windows to release its workspace handles before cleanup.
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      try {
        await waitForExit(child, 5_000);
      } catch {
        child.kill();
      }
    }
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  await waitForOutput(child, () => stdout, 'Choose a theme', 10_000, 0, () => stderr);
  assert.doesNotMatch(stdout, /injected env/i, 'interactive startup should stay clear of dotenv banners');
  child.stdin.write('2');
  await waitForOutput(child, () => stdout, '❯ 2. Warm light', 8_000, 0, () => stderr);
  child.stdin.write('\r');
  await waitForOutput(child, () => stdout, 'Trust this workspace', 8_000, 0, () => stderr);
  assert.equal(fs.readFileSync(path.join(home, '.vertex-ui-theme'), 'utf8'), 'warm-light\n');
  const beforeTrust = stdout.length;
  child.stdin.write('1');
  await waitForOutput(child, () => stdout, 'Welcome to VERTEX', 8_000, beforeTrust, () => stderr);

  async function typeAndSubmit(command) {
    const before = stdout.length;
    child.stdin.write(command);
    await waitForOutput(child, () => stdout, '❯  ' + command, 8_000, before, () => stderr);
    const beforeSubmit = stdout.length;
    child.stdin.write('\r');
    if (command !== '/exit') {
      await waitForOutput(child, () => stdout, /\n❯[ \t]*\r?\n/, 8_000, beforeSubmit, () => stderr);
    }
  }

  const beforeDraft = stdout.length;
  child.stdin.write('/hel');
  await waitForOutput(child, () => stdout, '❯  /hel', 8_000, beforeDraft, () => stderr);
  const beforeCompletion = stdout.length;
  child.stdin.write('\t');
  await waitForOutput(child, () => stdout, '❯  /help', 8_000, beforeCompletion, () => stderr);
  assert.ok(!stdout.includes('VERTEX COMMANDS'), 'Tab completion must not execute help');
  child.stdin.write('\r');
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
    await typeAndSubmit(command);
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
    await typeAndSubmit(command);
    await waitForOutput(child, () => stdout, expected, 8_000, before);
  }

  assert.equal(fs.existsSync(path.join(cwd, '.env')), true, '/init should create only the temporary workspace template');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(cwd, '.env')).mode & 0o777, 0o600, '/init must use restrictive permissions');
  }

  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK7sAAAAASUVORK5CYII=';
  const contents = 'A marker present only in the text fixture.';
  fs.writeFileSync(path.join(cwd, 'notes draft.md'), contents);
  fs.writeFileSync(path.join(cwd, 'diagram.png'), Buffer.from(image, 'base64'));
  const screenAfter = async (keys, expected) => {
    const start = stdout.length;
    child.stdin.write(keys);
    await waitForOutput(child, () => stdout, expected, 8_000, start, () => stderr);
    return stdout.slice(start);
  };

  for (const clear of ['clear', '/clear']) {
    await typeAndSubmit('/attach "notes draft.md" diagram.png');
    await screenAfter(clear, '❯  ' + clear);
    const reset = await screenAfter('\r', 'Welcome to VERTEX');
    assert.ok(reset.includes('\x1b[2J'));
    assert.doesNotMatch(reset.slice(reset.lastIndexOf('\x1b[2J')), /TASK SUMMARY|2 attached|Trust this workspace/);
  }

  const draft = '  Compare these fixtures.\n' + 'middle line\n'.repeat(400) + 'end marker  \n';
  const newline = draft.indexOf('\n');
  await screenAfter(draft.slice(0, newline), 'Compare these fixtures.');
  await screenAfter('\x1b[13;2u', 'Enter send');
  const preview = await screenAfter('\x1b[200~' + draft.slice(newline + 1) + '\x1b[201~', 'end marker');
  assert.ok(!preview.includes('Compare these fixtures'), 'long paste should have a compact preview');
  await screenAfter('\t', 'Drop or paste workspace paths');
  await screenAfter('\x1b', 'end marker');
  await screenAfter('\t', 'Drop or paste workspace paths');
  await screenAfter('"notes draft.md" diagram.png', 'diagram.png');
  await screenAfter('\r', '2 attached');
  assert.equal(provider.requests.length, 0, 'paste and attachment selection must never submit the draft');
  await screenAfter('\r', 'Attachment scenario complete');
  assert.equal(provider.requests.length, 5);
  const firstPrompt = provider.requests[0].messages.at(-1).content;
  assert.ok(firstPrompt.startsWith(draft + '\n\nUser-selected workspace attachments'), 'submit should preserve every character');
  assert.ok(firstPrompt.includes('"path":"notes draft.md"') && firstPrompt.includes('"path":"diagram.png"'));
  const vision = provider.requests.find(body => body.model === 'vision-fixture');
  assert.equal(vision.messages[0].content[1].image_url.url, 'data:image/png;base64,' + image);
  const tools = provider.requests.flatMap(body => body.messages.filter(message => message.role === 'tool'));
  assert.ok(tools.some(message => message.name === 'read_file' && message.content === contents));
  assert.ok(tools.some(message => message.name === 'analyze_image' && message.content === 'Image fixture received'));
  assert.doesNotMatch(stdout, /TASK SUMMARY|Based on returned text/);

  await typeAndSubmit('/exit');
  assert.equal(await waitForExit(child), 0, stderr);
});

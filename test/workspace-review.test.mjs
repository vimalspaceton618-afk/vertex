import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { reviewWorkspace } from '../dist/workspace-review.cjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

test('desktop and CLI share a read-only Git workspace report', async t => {
  const root = mkdtempSync(join(tmpdir(), 'vertex review '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '--quiet');
  const example = join(root, 'example.txt');
  writeFileSync(example, 'staged line\n');
  git('add', '--', 'example.txt');
  writeFileSync(example, 'unstaged line\n');
  writeFileSync(join(root, 'new.txt'), 'untracked\n');
  const before = git('status', '--short');

  const result = await reviewWorkspace(root);
  assert.equal(result.status, before);
  assert.match(result.staged, /\+staged line/);
  assert.match(result.unstaged, /\+unstaged line/);
  assert.match(result.status, /\?\? new\.txt/);
  const output = execFileSync(process.execPath, [cli, 'review', root, '--json'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), result);
  assert.equal(git('status', '--short'), before);

  const summaryOutput = execFileSync(process.execPath, [cli, 'review', root, '--stat', '--json'], { encoding: 'utf8' });
  const summary = JSON.parse(summaryOutput);
  assert.equal(summary.status, result.status);
  assert.match(summary.staged, /example\.txt/);
  assert.match(summary.unstaged, /example\.txt/);
  assert.doesNotMatch(summary.staged + summary.unstaged, /staged line|unstaged line/);
  assert.equal(git('status', '--short'), before);

  const nested = join(root, 'child');
  mkdirSync(nested);
  await assert.rejects(reviewWorkspace(nested), /root of the Git repository/);
});

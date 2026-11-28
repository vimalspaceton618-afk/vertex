import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { addAttachments, promptWithAttachments } from '../dist/terminal/attachments.js';

test('attach multiple workspace files, deduplicate, and preserve a multiline prompt', t => {
  const root = mkdtempSync(join(tmpdir(), 'vertex-attachments-'));
  const previous = process.env.VERTEX_WORKSPACE_ROOT;
  process.env.VERTEX_WORKSPACE_ROOT = root;
  t.after(() => {
    if (previous === undefined) delete process.env.VERTEX_WORKSPACE_ROOT;
    else process.env.VERTEX_WORKSPACE_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  });
  for (const name of ['a note.txt', 'diagram.PNG']) writeFileSync(join(root, name), 'fixture');
  const attachments = addAttachments([], '"a note.txt" diagram.PNG');
  assert.deepEqual(attachments, [
    { path: 'a note.txt', kind: 'file' },
    { path: 'diagram.PNG', kind: 'image' },
  ]);
  assert.deepEqual(addAttachments(attachments, 'diagram.PNG'), attachments);
  assert.throws(() => addAttachments([], '../outside.txt'), /escapes workspace/);
  assert.throws(() => addAttachments([], '"a note.txt'), /Quote a path/);
  const prompt = 'Compare the files\n' + 'long-context\n'.repeat(1000);
  assert.ok(promptWithAttachments(prompt, attachments).startsWith(prompt));
});

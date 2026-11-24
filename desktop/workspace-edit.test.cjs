const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, readFile, writeFile, mkdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readSource, previewEdit, applyEdit } = require('./workspace-edit.cjs');
const { proposeSourceEdit } = require('./deepseek.cjs');

test('requests a structured edit, previews it, and writes the approved replacement only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'vertex edit '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'math.js');
  await writeFile(file, 'function add(a, b) {\r\n  return a - b;\r\n}\r\n');
  const snapshot = await readSource(root, file);
  const answer = await proposeSourceEdit({
    key: 'test', model: 'deepseek-flash', task: 'Fix addition', context: snapshot.text,
  }, async (_url, options) => {
    assert.equal(JSON.parse(options.body).response_format.type, 'json_object');
    return Response.json({ choices: [{ message: {
      content: JSON.stringify({ find: '  return a - b;\n', replace: '  return a + b;\n' }),
    } }] });
  });
  const edit = previewEdit(snapshot.text, answer);
  assert.equal(await readFile(file, 'utf8'), snapshot.text);
  await applyEdit(snapshot, edit);
  assert.equal(await readFile(file, 'utf8'), snapshot.text.replace('a - b', 'a + b'));
  await assert.rejects(applyEdit(snapshot, edit), /changed since review/);
});

test('rejects out of scope paths and ambiguous edits', async t => {
  const root = await mkdtemp(join(tmpdir(), 'vertex edit '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inside = join(root, 'inside');
  await mkdir(inside);
  await assert.rejects(readSource(inside, join(root, 'outside.js')), /inside the workspace/);
  await assert.rejects(readSource(root, join(root, '.git', 'file.js')), /inside the workspace/);
  assert.throws(() => previewEdit('a a', '{"find":"a","replace":"b"}'), /unique/);
  assert.throws(() => previewEdit('a', '{"find":"a","replace":"a"}'), /unique/);
});

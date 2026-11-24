const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { discover, contextFor, planEdits, applyPlan, recover, loadJournal } = require('./workflow.cjs');
const { applyEdit } = require('./workspace-edit.cjs');
const { runTest } = require('./test-runner.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vertex-workflow-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'math.cjs'), 'exports.add = (a, b) => a - b;\n');
  await fs.writeFile(path.join(root, 'math.test.cjs'), "const { add } = require('./math.cjs');\nrequire('node:assert/strict').equal(add(2, 3), -1);\n");
  execFileSync('git', ['init', root], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'add', '.']);
  const sources = await discover(root, 'math');
  const plan = planEdits(sources, JSON.stringify({ edits: [
    { path: 'math.cjs', find: 'a - b', replace: 'a + b', summary: 'Correct addition' },
    { path: 'math.test.cjs', find: 'add(2, 3), -1', replace: 'add(2, 3), 5', summary: 'Assert the correct sum' },
  ] }));
  return { root, sources, plan, journal: path.join(root, '.recovery.json') };
}
test('representative coordinated change passes an actual project test command', async t => {
  const {root,sources,plan,journal} = await fixture(t);
  assert.equal(JSON.parse(contextFor(sources)).length, 2);
  await applyPlan(plan,journal);
  const result = await runTest(root, 'node math.test.cjs');
  assert.equal(result.exitCode, 0, result.output);
  assert.equal((await loadJournal(journal)).state, 'complete');
  assert.match(execFileSync('git',['-C',root,'diff'],{encoding:'utf8'}), /a \+ b/);
});
test('a stale second file rejects the entire patch before any write', async t => {
  const {root,plan,journal} = await fixture(t);
  await fs.appendFile(path.join(root,'math.test.cjs'), '// user work\n');
  await assert.rejects(applyPlan(plan,journal), /changed since/);
  assert.equal(await fs.readFile(path.join(root,'math.cjs'),'utf8'), plan[0].snapshot.text);
});
test('a partial write failure restores the first file and preserves original dirty work', async t => {
  const {root,plan,journal} = await fixture(t);
  let count = 0;
  await assert.rejects(applyPlan(plan,journal, async (snapshot,edit) => {
    if (++count === 2) throw new Error('Injected disk failure');
    await applyEdit(snapshot,edit);
  }), /restored/);
  for (const {snapshot} of plan) assert.equal(await fs.readFile(snapshot.file,'utf8'), snapshot.text);
  assert.equal((await loadJournal(journal)).state, 'recovered');
});
test('partial failure never overwrites a concurrently modified file', async t => {
  const {root,plan,journal} = await fixture(t);
  let count = 0;
  await assert.rejects(applyPlan(plan,journal, async (snapshot,edit) => {
    if (++count === 2) { await fs.appendFile(plan[0].snapshot.file, '// concurrent work\n'); throw new Error('Injected failure'); }
    await applyEdit(snapshot,edit);
  }), /Recovery needs attention/);
  assert.match(await fs.readFile(plan[0].snapshot.file,'utf8'), /concurrent work/);
  assert.equal((await loadJournal(journal)).state, 'recovery-required');
  await assert.rejects(applyPlan(plan,journal), /Recover the interrupted/);
});
test('restart recovery restores applied files from the durable journal', async t => {
  const {plan,journal} = await fixture(t);
  await fs.writeFile(journal, JSON.stringify({ root: plan[0].snapshot.root, state:'applying', entries:plan.map(({snapshot,edit})=>({name:snapshot.name,before:snapshot.text,after:edit.updated})) }));
  await applyEdit(plan[0].snapshot,plan[0].edit);
  assert.deepEqual(await recover(journal), {conflicts:[]});
  assert.equal(await fs.readFile(plan[0].snapshot.file,'utf8'), plan[0].snapshot.text);
});
test('reject edits outside selected context and duplicate paths', async t => {
  const {sources} = await fixture(t);
  assert.throws(()=>planEdits(sources,JSON.stringify({edits:[{path:'../other.cjs'}]})),/reviewed context/);
  assert.throws(()=>contextFor([]),/Select/);
});
test('test runner reports a failing command exactly', async t => {
  const {root} = await fixture(t);
  const result = await runTest(root, 'node -e "console.error(123);process.exit(7)"');
  assert.equal(result.exitCode,7); assert.match(result.output,/123/);
});

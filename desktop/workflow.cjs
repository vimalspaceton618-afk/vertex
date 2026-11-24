const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { join } = require('node:path');
const { readSource, previewEdit, applyEdit } = require('./workspace-edit.cjs');
const { mkdir, readFile, writeFile, rename } = require('node:fs/promises');
const run = promisify(execFile);

async function discover(root, task = '') {
  const { stdout } = await run('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const words = String(task).toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
  const paths = stdout.split('\0').filter(Boolean).filter(name => !/(^|\/)(node_modules|vendor|dist|build|coverage)(\/|$)/.test(name));
  const ranked = paths.map(name => ({ name, score: words.reduce((n, word) => n + (name.toLowerCase().includes(word) ? 10 : 0), 0) })).sort((a,b) => b.score-a.score || a.name.localeCompare(b.name));
  const files = [];
  for (const { name } of ranked.slice(0, 1000)) {
    try { const source = await readSource(root, join(root, name)); files.push(source); } catch { /* Unsupported sources are excluded. */ }
    if (files.length === 80) break;
  }
  return files;
}
function contextFor(sources) {
  const context = JSON.stringify(sources.map(({ name, text }) => ({ path: name, text })));
  if (!sources.length || sources.length > 12 || context.length > 32000) throw new Error('Select 1–12 files with at most 32,000 context characters.');
  return context;
}
function planEdits(sources, response) {
  let data;
  try { data = JSON.parse(response); } catch { throw new Error('The model returned invalid JSON. Generate a fresh proposal.'); }
  if (!Array.isArray(data.edits) || !data.edits.length || data.edits.length > 12) throw new Error('The model must propose 1–12 file edits.');
  const seen = new Set();
  return data.edits.map(item => {
    const snapshot = sources.find(source => source.name === item.path);
    if (!snapshot || seen.has(item.path)) throw new Error('Each edit must target a different reviewed context file.');
    seen.add(item.path);
    return { snapshot, edit: previewEdit(snapshot.text, JSON.stringify(item)) };
  });
}
async function saveJournal(file, journal) {
  await mkdir(require('node:path').dirname(file), { recursive: true });
  await writeFile(file + '.tmp', JSON.stringify(journal), { mode: 0o600 });
  await rename(file + '.tmp', file);
}
async function loadJournal(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function assertFresh(plan) {
  for (const { snapshot } of plan) {
    const current = await readSource(snapshot.root, snapshot.file);
    if (current.text !== snapshot.text || current.stat.ino !== snapshot.stat.ino || current.stat.dev !== snapshot.stat.dev) throw new Error(snapshot.name + ' changed since context review. Rediscover and generate a new proposal.');
  }
}
async function recover(file) {
  const journal = await loadJournal(file);
  if (!journal || journal.state === 'complete' || journal.state === 'recovered') return { conflicts: [] };
  const conflicts = [];
  for (const entry of [...journal.entries].reverse()) {
    try {
      const current = await readSource(journal.root, join(journal.root, entry.name));
      if (current.text === entry.before) continue;
      if (current.text !== entry.after) { conflicts.push(entry.name); continue; }
      await applyEdit(current, { updated: entry.before });
    } catch { conflicts.push(entry.name); }
  }
  journal.state = conflicts.length ? 'recovery-required' : 'recovered';
  journal.conflicts = conflicts;
  await saveJournal(file, journal);
  return { conflicts };
}
async function applyPlan(plan, journalFile, apply = applyEdit) {
  const old = await loadJournal(journalFile);
  if (old && !['complete', 'recovered'].includes(old.state)) throw new Error('Recover the interrupted patch before applying another.');
  await assertFresh(plan);
  const journal = { root: plan[0].snapshot.root, state: 'applying', entries: plan.map(({snapshot, edit}) => ({ name: snapshot.name, before: snapshot.text, after: edit.updated })) };
  await saveJournal(journalFile, journal);
  try {
    for (const entry of plan) await apply(entry.snapshot, entry.edit);
    journal.state = 'complete';
    await saveJournal(journalFile, journal);
  } catch (error) {
    const recovery = await recover(journalFile);
    throw new Error(error.message + (recovery.conflicts.length ? '\nRecovery needs attention: ' + recovery.conflicts.join(', ') + '\nOriginal contents are saved in ' + journalFile : '\nAny applied files were restored; existing work was preserved.'));
  }
}
module.exports = { discover, contextFor, planEdits, applyPlan, recover, loadJournal };

const api = window.vertexReview;
const $ = id => document.getElementById(id);
let hasWorkspace = false, contextReady = false, busy = false;
function locks() {
  document.querySelectorAll('button,input,textarea,select').forEach(el => { el.disabled = busy; });
  for (const id of ['refresh','discover','test']) $(id).disabled = busy || !hasWorkspace;
  $('open-file').disabled = busy || !hasWorkspace;
  $('pet').disabled = false;
  $('propose').disabled = busy || !contextReady;
}
async function action(message, fn) {
  if (busy) return;
  busy = true; window.catWorking(true); locks(); $('feedback').textContent = message;
  try { await fn(); } catch (error) { $('feedback').textContent = error.message; }
  finally { busy = false; window.catWorking(false); locks(); }
}
function showReport(report) {
  if (!report) return;
  hasWorkspace = true; $('workspace').textContent = report.root;
  for (const field of ['status','staged','unstaged']) $(field).textContent = report[field] || 'None';
  $('results').hidden = false;
}
function showHandoff(files = []) {
  $('applied-files').replaceChildren();
  for (const name of files) {
    const item = document.createElement('li');
    item.textContent = name;
    $('applied-files').append(item);
  }
  $('check-history').replaceChildren();
  $('check-status').textContent = 'No checks run since this patch was applied.';
  $('handoff').hidden = files.length === 0;
  $('test-output').hidden = true;
}
function addCheck(command, outcome) {
  if ($('handoff').hidden) return;
  const item = document.createElement('li');
  item.textContent = outcome + ' — ' + command;
  $('check-history').append(item);
  $('check-status').textContent = 'Checks requested since this patch was applied';
}
$('copy-handoff').onclick = () => action('Copying handoff…', async () => {
  const files = Array.from($('applied-files').children, item => '- ' + item.textContent);
  const checks = Array.from($('check-history').children, item => '- ' + item.textContent);
  const text = [
    'Vertex patch handoff', '', 'Files applied', ...files, '',
    'Checks', ...(checks.length ? checks : [$('check-status').textContent]),
  ].join('\n');
  await api.copyHandoff(text);
  $('feedback').textContent = 'Handoff copied to clipboard.';
});
function invalidate() { contextReady = false; $('context').hidden = true; $('patch-panel').hidden = true; locks(); }
$('open').onclick = () => action('Opening repository…', async () => {
  if (!canDiscard()) return;
  const report = await api.choose();
  if (report) { $('editor-panel').hidden = true; showReport(report); invalidate(); $('context-panel').hidden = true; showHandoff(); }
  $('feedback').textContent = report ? 'Repository ready. Describe your task.' : 'Folder selection cancelled.';
});
$('refresh').onclick = () => action('Reading Git changes…', async () => { showReport(await api.refresh()); $('feedback').textContent = 'Workspace changes refreshed.'; });
$('task').oninput = () => { $('patch-panel').hidden = true; };
$('discover').onclick = () => action('Discovering tracked source files…', async () => {
  invalidate();
  const files = await api.discover({ task: $('task').value });
  $('files').replaceChildren();
  files.forEach(file => {
    const label = document.createElement('label'), check = document.createElement('input');
    check.type = 'checkbox'; check.value = file.name; check.onchange = invalidate;
    label.append(check, document.createTextNode(file.name + ' · ' + file.text.length.toLocaleString() + ' characters'));
    $('files').append(label);
  });
  $('context-count').textContent = files.length + ' available'; $('context-panel').hidden = false;
  $('feedback').textContent = files.length ? 'Select relevant files, then preview the exact context.' : 'No supported tracked source files found (24 KB per file limit).';
});
$('preview-context').onclick = () => action('Preparing context…', async () => {
  contextReady = false;
  const names = [...$('files').querySelectorAll('input:checked')].map(el => el.value);
  $('context').textContent = await api.context(names); $('context').hidden = false; contextReady = true;
  $('feedback').textContent = 'Context ready for review. Nothing has been sent yet.';
});
$('propose').onclick = () => action('Vertex is preparing a patch with your provider…', async () => {
  $('patch-panel').hidden = true;
  const edits = await api.proposeWorkspace({ task: $('task').value, key: $('api-key').value.trim(), base: $('base').value.trim(), model: $('model').value.trim() });
  $('patches').replaceChildren();
  edits.forEach(edit => {
    const article = document.createElement('article'), title = document.createElement('h3'), summary = document.createElement('p'), diff = document.createElement('div');
    title.textContent = edit.name; summary.textContent = edit.summary; diff.className = 'diff';
    for (const [label, text] of [['Before',edit.before],['After',edit.after]]) { const pre = document.createElement('pre'); pre.textContent = label + '\n\n' + text; diff.append(pre); }
    article.append(title,summary,diff); $('patches').append(article);
  });
  $('patch-panel').hidden = false; $('feedback').textContent = edits.length + ' file changes ready. Review each change before applying.';
});
$('apply').onclick = () => action('Checking reviewed files…', async () => {
  try {
    const files = await api.applyWorkspace();
    if (files) {
      showHandoff(files);
      invalidate();
      $('context-panel').hidden = true;
      $('feedback').textContent = 'Patch applied. Run your project tests to verify the change.';
    }
    else { $('feedback').textContent = 'Application cancelled.'; return; }
  } catch (error) { $('patch-panel').hidden = true; await recoveryStatus(); throw error; }
  showReport(await api.refresh());
});
$('test').onclick = () => action('Waiting for command approval and test result…', async () => {
  const command = $('command').value;
  const result = await api.runTest(command);
  if (!result) {
    addCheck(command, 'Skipped (approval cancelled)');
    $('feedback').textContent = 'Command cancelled.';
    return;
  }
  const passed = result.exitCode === 0 && !result.reason && !result.signal;
  const outcome = result.reason || result.signal || 'exit ' + result.exitCode;
  addCheck(result.command, (passed ? 'Passed' : 'Failed') + ' (' + outcome + ')');
  $('test-output').hidden = false;
  $('test-output').textContent = JSON.stringify({ command: result.command, cwd: result.cwd, exitCode: result.exitCode, signal: result.signal, durationMs: result.durationMs, reason: result.reason }, null, 2) + '\n\n' + result.output;
  $('feedback').textContent = passed ? 'Test command passed (exit 0).' : 'Test command did not pass. See the exact result below.';
  showReport(await api.refresh());
});
async function recoveryStatus() {
  const status = await api.recoveryStatus(); $('recovery').hidden = !status;
  if (status) $('recovery-detail').textContent = 'An interrupted patch needs recovery in ' + status.root + '. Original contents: ' + status.file;
}
$('recover').onclick = () => action('Recovering interrupted patch…', async () => {
  const result = await api.recover(); await recoveryStatus();
  $('feedback').textContent = !result ? 'Recovery cancelled.' : result.conflicts.length ? 'Preserved changed files needing manual recovery: ' + result.conflicts.join(', ') : 'Original files restored.';
});

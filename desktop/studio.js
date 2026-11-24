let editorOriginal = '', savedBase = '', savedKey = false;
function syncProvider() {
  $('badge').textContent = $('model').value || 'Choose model';
  $('destination').textContent = $('base').value;
  $('api-key').placeholder = savedKey && savedBase === $('base').value ? 'Saved in Windows' : 'Enter key';
}
function showProfile(profile) {
  savedBase = profile.base; savedKey = profile.saved;
  $('base').value = profile.base; $('model').value = profile.model;
  $('preset').selectedIndex = profile.base === 'https://api.deepseek.com' ? 0 : 1;
  $('api-key').value = ''; syncProvider();
}
$('base').oninput = () => { $('api-key').value = ''; $('preset').selectedIndex = 1; syncProvider(); };
$('model').oninput = syncProvider;
$('preset').onchange = () => {
  const deepseek = !$('preset').selectedIndex;
  $('base').value = deepseek ? 'https://api.deepseek.com' : '';
  $('model').value = deepseek ? 'deepseek-flash' : '';
  $('api-key').value = ''; syncProvider(); $('base').focus();
};
for (const id of ['save-provider','forget']) $(id).onclick = () => action('Updating provider…', async () => {
  const forget = id === 'forget';
  showProfile(await api.saveProfile({base: $('base').value.trim(), model: $('model').value.trim(), key: forget ? '' : $('api-key').value.trim(), forget}));
  $('feedback').textContent = 'Provider settings saved.';
});
$('providers').onclick = $('badge').onclick = () => { $('settings').open = true; $('settings').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('preset').focus({ preventScroll: true }); };
function dirtyEditor() {
  return !$('editor-panel').hidden && $('editor').value !== editorOriginal.replace(/\r\n?/g, '\n');
}
function canDiscard() { return !dirtyEditor() || confirm('Discard unsaved file edits?'); }
window.addEventListener('beforeunload', event => { if (!canDiscard()) event.returnValue = false; });
$('open-file').onclick = () => action('Opening source…', async () => {
  if (!canDiscard()) return;
  const file = await api.openFile();
  if (!file) return;
  editorOriginal = file.text; $('editor').value = file.text; $('filename').textContent = file.name;
  $('editor-panel').hidden = false; $('feedback').textContent = 'Opened ' + file.name;
});
$('save-file').onclick = () => action('Saving file…', async () => {
  let text = $('editor').value;
  if (editorOriginal.includes('\r\n')) text = text.replace(/\n/g, '\r\n');
  await api.saveFile(text); editorOriginal = text; invalidate(); $('context-panel').hidden = true;
  showReport(await api.refresh()); $('feedback').textContent = 'File saved.';
});
let tipTimer;
$('pet').addEventListener('click', () => {
  const tip = busy ? $('feedback').textContent
    : !hasWorkspace ? 'Pick a repository to start.'
    : !$('patch-panel').hidden ? 'Check the before and after text, then apply.'
    : contextReady ? 'Review the context and provider before sending.'
    : !$('context-panel').hidden ? 'Select the files that explain your task.'
    : 'Open a source file, or describe a change in Task.';
  $('cat-tip').textContent = tip; $('cat-tip').hidden = false;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => { $('cat-tip').hidden = true; }, 4500);
});
const commands = { '/open':'open', '/edit':'open-file', '/provider':'providers', '/changes':'refresh', '/test':'test', '/about':'about', '/help':'commands' };
function info(title, body) {
  $('info-title').textContent = title; $('info-body').textContent = body; $('info').showModal();
}
$('commands').onclick = () => info('Slash commands', 'Type a command in the task box and press Enter. Ctrl/⌘ + Enter discovers context.\n\n' + Object.entries(commands).map(([cmd,id]) => cmd + '   ' + $(id).textContent).join('\n'));
$('about').onclick = () => info('About Vertex', 'Vertex coding studio shares Git workspace review with the Vertex CLI. Inspect source, edit files, and verify a reviewed patch in your repository.');
$('dismiss').onclick = () => $('info').close();
// Theme is only a local UI preference; credentials remain in the OS-backed store.
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  $('theme-toggle').textContent = theme === 'dark' ? '☼ Light theme' : '◐ Dark theme';
  $('theme-toggle').setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
let theme = 'light';
try { if (localStorage.getItem('vertex-studio-theme') === 'dark') theme = 'dark'; } catch {}
applyTheme(theme);
$('theme-toggle').onclick = () => {
  theme = theme === 'light' ? 'dark' : 'light';
  applyTheme(theme);
  try { localStorage.setItem('vertex-studio-theme', theme); } catch {}
};
$('task').onkeydown = event => {
  const cmd = $('task').value.trim();
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !$('discover').disabled) { event.preventDefault(); $('discover').click(); return; }
  if (event.key !== 'Enter' || event.shiftKey || !cmd.startsWith('/')) return;
  event.preventDefault();
  const target = Object.hasOwn(commands, cmd) && $(commands[cmd]);
  if (!target || target.disabled) { $('feedback').textContent = target ? 'Open a repository first.' : 'Unknown command. Type /help for commands.'; return; }
  $('task').value = ''; target.click();
};
locks(); action('Opening studio…', async () => { showProfile(await api.profile()); await recoveryStatus(); $('feedback').textContent = 'Open a Git repository to start.'; });

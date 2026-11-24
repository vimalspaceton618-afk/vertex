const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { basename, dirname, join } = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const page = join(__dirname, 'index.html');
let window;
let workspace;

const installEvent = process.argv.find(arg => /^--squirrel-(install|updated|uninstall|obsolete)$/.test(arg));
if (installEvent) {
  if (installEvent === '--squirrel-obsolete') {
    app.quit();
  } else {
    const update = join(dirname(process.execPath), '..', 'Update.exe');
    const operation = installEvent === '--squirrel-uninstall' ? '--removeShortcut' : '--createShortcut';
    const child = spawn(update, [operation, basename(process.execPath)], { windowsHide: true });
    child.once('error', () => app.quit());
    child.once('exit', () => app.quit());
  }
} else {
  app.whenReady().then(() => {
    const { reviewWorkspace } = require('./workspace-review.cjs');
    window = new BrowserWindow({
      width: 1380, height: 900, minWidth: 900, minHeight: 650, backgroundColor: '#101113', title: 'Vertex',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true,
      },
    });
    const contents = window.webContents;
    contents.on('will-navigate', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.session.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));

    function trusted(event) {
      return event.sender === contents && event.senderFrame === contents.mainFrame &&
        event.senderFrame?.url === pathToFileURL(page).href;
    }
    const { readSource, previewEdit, applyEdit } = require('./workspace-edit.cjs');
    const workflow = require('./workflow.cjs');
    const { runTest } = require('./test-runner.cjs');
    const { proposeWorkspace } = require('./deepseek.cjs');
    const journalFile = join(app.getPath('userData'), 'patch-recovery.json');
    let discovered = [];
    let selected = [];
    let plan;
    let source;
    let pending;
    let busy = false;
    function register(name, handler) {
      ipcMain.handle(name, async (event, input) => {
        if (!trusted(event) || busy) throw new Error('Finish the current operation first.');
        busy = true;
        try {
          return await handler(input);
        } finally {
          busy = false;
        }
      });
    }

    register('review:choose', async () => {
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      if (result.canceled) return null;
      const report = await reviewWorkspace(result.filePaths[0]);
      workspace = report.root;
      discovered = []; selected = []; plan = undefined;
      source = undefined;
      pending = undefined;
      return report;
    });
    ipcMain.handle('review:refresh', event => {
      if (!trusted(event) || !workspace) throw new Error('Choose a workspace first.');
      return reviewWorkspace(workspace);
    });
    register('agent:discover', async input => {
      if (!workspace) throw new Error('Open a repository first.');
      plan = undefined; selected = [];
      discovered = await workflow.discover(workspace, input?.task);
      return discovered.map(({name, text}) => ({ name, text }));
    });
    register('agent:context', async names => {
      plan = undefined;
      if (!Array.isArray(names) || new Set(names).size !== names.length) throw new Error('Select context files.');
      selected = names.map(name => {
        const file = discovered.find(file => file.name === name);
        if (!file) throw new Error('Rediscover context first.');
        return file;
      });
      return workflow.contextFor(selected);
    });
    register('agent:propose', async input => {
      plan = undefined;
      const context = workflow.contextFor(selected);
      const response = await proposeWorkspace({ key: input?.key, model: input?.model, task: input?.task, context });
      plan = workflow.planEdits(selected, response);
      return plan.map(({ snapshot, edit }) => ({ name: snapshot.name, before: edit.find, after: edit.replacement, summary: edit.summary }));
    });
    register('agent:apply', async () => {
      if (!plan) throw new Error('Generate and review a patch first.');
      const confirm = await dialog.showMessageBox(window, {
        type: 'question', buttons: ['Cancel', 'Apply patch'], defaultId: 0, cancelId: 0,
        message: 'Apply all reviewed changes?', detail: plan.map(entry => entry.snapshot.file).join('\n'),
      });
      if (confirm.response !== 1) return false;
      const approved = plan; plan = undefined;
      await workflow.applyPlan(approved, journalFile);
      selected = []; discovered = [];
      return true;
    });
    register('agent:test', async command => {
      if (!workspace) throw new Error('Open a repository first.');
      if (typeof command !== 'string') throw new Error('Enter a test command.');
      const confirm = await dialog.showMessageBox(window, {
        type: 'warning', buttons: ['Cancel', 'Run command'], defaultId: 0, cancelId: 0,
        message: 'Run this command with your user permissions?', detail: workspace + '\n\n' + command,
      });
      if (confirm.response !== 1) return null;
      return runTest(workspace, command);
    });
    register('agent:recovery-status', async () => {
      const journal = await workflow.loadJournal(journalFile);
      return journal && !['complete', 'recovered'].includes(journal.state) ? { root: journal.root, file: journalFile, names: journal.entries.map(entry => entry.name) } : null;
    });
    register('agent:recover', async () => {
      const journal = await workflow.loadJournal(journalFile);
      if (!journal) return null;
      const confirm = await dialog.showMessageBox(window, {
        type: 'question', buttons: ['Cancel', 'Restore originals'], defaultId: 0, cancelId: 0,
        message: 'Recover the interrupted patch?', detail: journal.root + '\nFiles edited since application will be preserved and reported as conflicts.',
      });
      if (confirm.response !== 1) return null;
      return workflow.recover(journalFile);
    });
    return window.loadFile(page);
  }).catch(error => {
    dialog.showErrorBox('Vertex could not start', error.message);
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit());

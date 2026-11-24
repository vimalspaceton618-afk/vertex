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
      width: 1050, height: 720, title: 'Vertex',
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
      source = undefined;
      pending = undefined;
      return report;
    });
    ipcMain.handle('review:refresh', event => {
      if (!trusted(event) || !workspace) throw new Error('Choose a workspace first.');
      return reviewWorkspace(workspace);
    });
    const { proposeSourceEdit, proposePatch } = require('./deepseek.cjs');
    register('coding:choose-file', async () => {
      if (!workspace) throw new Error('Open a Git workspace first.');
      const result = await dialog.showOpenDialog(window, { defaultPath: workspace, properties: ['openFile'] });
      if (result.canceled) return null;
      const selected = await readSource(workspace, result.filePaths[0]);
      source = selected;
      pending = undefined;
      return { name: source.name, text: source.text };
    });
    register('coding:propose', async input => {
      if (!input || typeof input !== 'object') throw new Error('Enter a coding task first.');
      pending = undefined;
      if (!input.useFile) return { text: await proposePatch(input) };
      if (!source || !workspace) throw new Error('Choose a source file first.');
      const snapshot = source;
      const response = await proposeSourceEdit({
        key: input.key, model: input.model, task: input.task,
        context: snapshot.name + '\n' + snapshot.text,
      });
      pending = { snapshot, edit: previewEdit(snapshot.text, response) };
      const { find, replacement, summary } = pending.edit;
      return { name: snapshot.name, find, replacement, summary };
    });
    register('coding:apply', async () => {
      if (!pending) throw new Error('Generate a fresh edit first.');
      const { snapshot, edit } = pending;
      const confirm = await dialog.showMessageBox(window, {
        type: 'question', buttons: ['Cancel', 'Apply edit'], defaultId: 0, cancelId: 0,
        message: 'Apply the reviewed edit?',
        detail: snapshot.file,
      });
      if (confirm.response !== 1) return false;
      await applyEdit(snapshot, edit);
      pending = undefined;
      source = undefined;
      return true;
    });
    return window.loadFile(page);
  }).catch(error => {
    dialog.showErrorBox('Vertex could not start', error.message);
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit());

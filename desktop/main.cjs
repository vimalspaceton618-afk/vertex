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
    ipcMain.handle('review:choose', async event => {
      if (!trusted(event)) throw new Error('Workspace selection is unavailable.');
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      if (result.canceled) return null;
      workspace = result.filePaths[0];
      return reviewWorkspace(workspace);
    });
    ipcMain.handle('review:refresh', event => {
      if (!trusted(event) || !workspace) throw new Error('Choose a workspace first.');
      return reviewWorkspace(workspace);
    });
    const { proposePatch } = require('./deepseek.cjs');
    let proposing = false;
    ipcMain.handle('coding:propose', async (event, input) => {
      if (!trusted(event) || proposing || !input || typeof input !== 'object') {
        throw new Error('A coding request is already running or unavailable.');
      }
      proposing = true;
      try {
        return await proposePatch(input);
      } finally {
        proposing = false;
      }
    });
    return window.loadFile(page);
  }).catch(error => {
    dialog.showErrorBox('Vertex could not start', error.message);
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit());

// Run with Electron from the repository root. Provider and native approvals are mocked;
// the real renderer, preload IPC, Git, file writes, and project test command execute.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vertex-gui-'));
  app.setPath('userData', path.join(root, 'app-data'));
  await fs.writeFile(path.join(root,'math.cjs'), 'exports.add = (a,b) => a-b;\n');
  await fs.writeFile(path.join(root,'math.test.cjs'), "require('node:assert/strict').equal(require('./math.cjs').add(2,3),-1);\n");
  execFileSync('git',['init',root]); execFileSync('git',['-C',root,'add','.']);
  dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[root] });
  dialog.showMessageBox = async () => ({ response:1 });
  require('./deepseek.cjs').proposeWorkspace = async input => {
    assert.equal(JSON.parse(input.context).length,2);
    return JSON.stringify({edits:[{path:'math.cjs',find:'a-b',replace:'a+b',summary:'Correct addition'},{path:'math.test.cjs',find:'(2,3),-1',replace:'(2,3),5',summary:'Verify correct addition'}]});
  };
  require('./main.cjs');
  await app.whenReady();
  const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
  let win;
  for(let i=0;i<100;i++){ win=BrowserWindow.getAllWindows()[0]; if(win && !win.webContents.isLoading()) break; await wait(100); }
  const evaluate = code => win.webContents.executeJavaScript(code);
  async function idle() { for(let i=0;i<200;i++){ if(await evaluate("!document.getElementById('open').disabled")) return; await wait(50); } throw new Error('UI operation timed out'); }
  async function click(id){ await evaluate(`document.getElementById('${id}').click()`); await idle(); }
  await idle(); await click('open');
  await evaluate("document.getElementById('task').value='Correct addition and its test'");
  await click('discover');
  await evaluate("document.querySelectorAll('#files input').forEach(el=>{el.checked=true;el.dispatchEvent(new Event('change'))})");
  await click('preview-context'); await click('propose');
  assert.equal(await evaluate("document.querySelectorAll('#patches article').length"),2);
  await evaluate("document.getElementById('patch-panel').scrollIntoView({block:'center'})"); await wait(250);
  if(process.env.VERTEX_SCREENSHOT) await fs.writeFile(process.env.VERTEX_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
  dialog.showMessageBox = async () => ({ response:0 });
  await click('apply');
  assert.match(await fs.readFile(path.join(root,'math.cjs'),'utf8'), /a-b/);
  dialog.showMessageBox = async () => ({ response:1 });
  await click('apply');
  assert.match(await fs.readFile(path.join(root,'math.cjs'),'utf8'),/a\+b/);
  await evaluate("document.getElementById('command').value='node math.test.cjs'"); await click('test');
  assert.match(await evaluate("document.getElementById('test-output').textContent"), /"exitCode": 0/);
  console.log('PASS: real desktop context -> multi-file review -> approved apply -> project test. Provider and dialogs mocked.');
  win.destroy(); await fs.rm(root,{recursive:true,force:true}); app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});

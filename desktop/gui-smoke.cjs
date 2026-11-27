// Run with Electron from the repository root. Provider and native approvals are mocked;
// the real renderer, preload IPC, Git, file writes, and project test command execute.
const { app, BrowserWindow, clipboard, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
(async () => {
  // Use the same canonical path a native Windows file picker would return.
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, 'vertex-gui-'));
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
  await idle();
  await evaluate("document.getElementById('task').value='/about';document.getElementById('task').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))");
  assert.equal(await evaluate("document.getElementById('info').open"),true);
  await click('dismiss');
  await evaluate("document.getElementById('api-key').value='fixture-key'");
  await click('save-provider');
  assert.equal(await evaluate("document.getElementById('api-key').placeholder"),'Saved in Windows');
  await click('open');
  dialog.showOpenDialog = async () => ({canceled:false,filePaths:[path.join(root,'math.cjs')]});
  await click('open-file');
  assert.equal(await evaluate("document.getElementById('filename').textContent"), 'math.cjs',
    await evaluate("document.getElementById('feedback').textContent"));
  await evaluate("document.getElementById('editor').value += '// reviewed\\n'");
  await click('save-file');
  assert.match(await fs.readFile(path.join(root,'math.cjs'),'utf8'), /reviewed/);
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
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#applied-files li'), item => item.textContent).sort()"), ['math.cjs', 'math.test.cjs']);
  assert.match(await evaluate("document.getElementById('check-status').textContent"), /No checks run/);
  await evaluate("document.getElementById('command').value='node math.test.cjs'");
  dialog.showMessageBox = async () => ({ response:0 });
  await click('test');
  dialog.showMessageBox = async () => ({ response:1 });
  await click('test');
  await evaluate("document.getElementById('command').value='node -e process.exitCode=1'");
  await click('test');
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#check-history li'), item => item.textContent.split(' — ')[0])"), [
    'Skipped (approval cancelled)', 'Passed (exit 0)', 'Failed (exit 1)',
  ]);
  await evaluate("document.getElementById('command').value='node math.test.cjs'");
  await click('test');
  assert.match(await evaluate("document.getElementById('test-output').textContent"), /"exitCode": 0/);
  await click('copy-handoff');
  const handoff = clipboard.readText();
  assert.match(handoff, /- math\.cjs/);
  assert.match(handoff, /Skipped \(approval cancelled\)/);
  assert.match(handoff, /Passed \(exit 0\)/);
  assert.match(handoff, /Failed \(exit 1\)/);
  assert.ok(!handoff.includes(root));
  console.log('PASS: real desktop context -> multi-file review -> approved apply -> project test. Provider and dialogs mocked.');
  win.destroy(); await fs.rm(root,{recursive:true,force:true}); app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});

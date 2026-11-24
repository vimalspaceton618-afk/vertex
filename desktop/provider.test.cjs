const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { profileStore, baseURL } = require('./provider.cjs');
const { proposeWorkspace } = require('./deepseek.cjs');
test('saved keys stay private and bound to the configured endpoint', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'vertex-profile-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const file = path.join(dir,'profile.json');
  const store = profileStore(file,{isAsyncEncryptionAvailable:async()=>true, encryptStringAsync:async s=>Buffer.from(s), decryptStringAsync:async b=>({result:b.toString()})});
  const input = {base:'https://example.com/v1', model:'team/code', key:'private-key'};
  const view = await store.save(input);
  assert.equal(view.saved,true);
  assert.ok(!JSON.stringify(view).includes(input.key));
  assert.ok(!(await fs.readFile(file,'utf8')).includes(input.key));
  assert.equal(await store.credentials(input.base),input.key);
  assert.equal(await store.credentials('https://example.net/v1'),'');
  await store.save({...input,base:'https://example.net/v1',key:''});
  assert.equal(await store.credentials(input.base),'');
});
test('local compatible model uses configured path without an authorization header',async () => {
  assert.throws(()=>baseURL('http://example.com'));
  await proposeWorkspace({base:'http://localhost:1234/v1/',model:'local/code',task:'fix',context:'source'},async (url,options)=>{
    assert.equal(url,'http://localhost:1234/v1/chat/completions');
    assert.equal(options.headers.Authorization,undefined);
    assert.equal(JSON.parse(options.body).model,'local/code');
    return Response.json({choices:[{message:{content:'{"edits":[]}'}}]});
  });
});

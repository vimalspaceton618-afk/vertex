const assert = require('node:assert/strict');
const { test } = require('node:test');
const { proposePatch } = require('./deepseek.cjs');
const input = { key: 'test-key', model: 'deepseek-flash', task: 'Fix addition', context: 'add.js: return a - b' };

test('sends only provided context to DeepSeek and returns the patch', async () => {
  const text = await proposePatch(input, async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.deepEqual(JSON.parse(body.messages[1].content), { task: input.task, sourceContext: input.context });
    assert.ok(!options.body.includes(input.key));
    return Response.json({ choices: [{ message: { content: '--- a/add.js' } }] });
  });
  assert.equal(text, '--- a/add.js');
});

test('rejects unsupported inputs and reports provider errors and truncated output', async () => {
  await assert.rejects(proposePatch({ ...input, model: 'unknown' }), /supported/);
  await assert.rejects(proposePatch(input, async () => new Response(null, { status: 429 })), /429/);
  await assert.rejects(proposePatch(input, async () => Response.json({ choices: [{ finish_reason: 'length' }] })), /tokens/);
});

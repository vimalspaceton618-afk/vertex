import assert from 'node:assert/strict';
import test from 'node:test';
import { createStreamPreview } from '../dist/terminal/stream-preview.js';

test('stream preview publishes the latest cumulative text in a batch', async () => {
  const published = [];
  const preview = createStreamPreview(text => published.push(text), 5);
  preview.update('one');
  preview.update('one two');
  assert.deepEqual(published, []);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual(published, ['one two']);
});

test('flush publishes pending text once and cancel drops a stale update', async () => {
  const published = [];
  const preview = createStreamPreview(text => published.push(text), 5);
  preview.update('before approval');
  preview.flush();
  preview.flush();
  preview.update('stale');
  preview.cancel();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual(published, ['before approval']);
});

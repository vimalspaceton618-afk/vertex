import assert from 'node:assert/strict';
import test from 'node:test';
import { themeOptions } from '../dist/terminal/theme-preference.js';
import { themePetFrame } from '../dist/terminal/VertexPet.js';

test('all six themes have distinct pet faces within the same animated sprite bounds', () => {
  const faces = new Set();
  for (const { name } of themeOptions) {
    const resting = themePetFrame(name, 0);
    const moving = themePetFrame(name, 1);
    assert.notDeepEqual(resting, moving);
    assert.deepEqual(resting.map(row => row.length), [12, 12, 12, 12, 12]);
    assert.deepEqual(moving.map(row => row.length), [12, 12, 12, 12, 12]);
    faces.add(resting.slice(1, 3).join('\n'));
  }
  assert.equal(faces.size, themeOptions.length);
});

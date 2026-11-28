import assert from 'node:assert/strict';
import test from 'node:test';
import { nextGrapheme, normalizePaste, previousGrapheme, promptBoundary } from '../dist/terminal/prompt-text.js';

test('prompt cursor preserves combining characters and joined emoji', () => {
  const text = 'Ae\u0301👩‍💻';
  assert.equal(nextGrapheme(text, 1), 3);
  assert.equal(previousGrapheme(text, 3), 1);
  assert.equal(previousGrapheme(text, text.length), 3);
  assert.equal(promptBoundary(text, 2), 3);
  assert.equal(nextGrapheme(text, 3), text.length);
});

test('paste normalization preserves multilingual lines and strips terminal controls', () => {
  assert.equal(normalizePaste('தமிழ்\r\n漢字\r👩‍💻\u001b[31m!\u0007'), 'தமிழ்\n漢字\n👩‍💻!');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatApprovalAction } from '../dist/components.js';

test('approval display makes terminal controls and bidi markers visible', () => {
  assert.equal(
    formatApprovalAction('npm test\nதமிழ்\u001b[31m\u009b\u202e'),
    'npm test\\u000aதமிழ்\\u001b[31m\\u009b\\u202e'
  );
});

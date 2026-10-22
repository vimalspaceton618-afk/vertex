import test from 'node:test';
import assert from 'node:assert/strict';
import { forceSafeMode, getAutonomyMode } from '../dist/core/policy/ModeControl.js';

test('unknown autonomy mode fails closed to semi_auto', () => {
  const previous = process.env.AUTONOMY_MODE;
  try {
    process.env.AUTONOMY_MODE = 'unexpected-mode';
    assert.equal(getAutonomyMode(), 'semi_auto');
  } finally {
    if (previous === undefined) delete process.env.AUTONOMY_MODE;
    else process.env.AUTONOMY_MODE = previous;
  }
});

test('interactive safe mode can downgrade but cannot enable full-auto lab mode', () => {
  const previous = process.env.AUTONOMY_MODE;
  try {
    process.env.AUTONOMY_MODE = 'full_auto_lab';
    assert.equal(getAutonomyMode(), 'full_auto_lab');
    assert.equal(forceSafeMode(), 'semi_auto');
    assert.equal(process.env.AUTONOMY_MODE, 'semi_auto');
    assert.equal(getAutonomyMode(), 'semi_auto');
  } finally {
    if (previous === undefined) delete process.env.AUTONOMY_MODE;
    else process.env.AUTONOMY_MODE = previous;
  }
});

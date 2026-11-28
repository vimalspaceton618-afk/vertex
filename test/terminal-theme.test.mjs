import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTheme } from '../dist/terminal/theme.js';

test('theme names select complete, distinct palettes and invalid names use warm dark', () => {
  const names = ['warm-dark', 'warm-light', 'midnight', 'high-contrast-dark', 'high-contrast-light'];
  const colors = names.map(name => resolveTheme({ VERTEX_UI_THEME: name }).colors);
  assert.equal(new Set(colors.map(color => color.accent)).size, names.length);
  for (const palette of colors) {
    for (const color of Object.values(palette)) assert.match(color, /^#[0-9A-F]{6}$/);
  }
  assert.deepEqual(resolveTheme({ VERTEX_UI_THEME: '__proto__' }).colors, colors[0]);
});

test('NO_COLOR takes precedence over an explicit theme', () => {
  const config = resolveTheme({ NO_COLOR: '', FORCE_COLOR: '3', VERTEX_UI_THEME: 'warm-light' });
  assert.deepEqual(config.colors, resolveTheme({ VERTEX_UI_THEME: 'terminal' }).colors);
  assert.ok(Object.values(config.colors).every(color => color === undefined));
});

test('ASCII and reduced-motion options select accessible presentation defaults', () => {
  for (const env of [{ TERM: 'dumb' }, { VERTEX_UI_ASCII: '1' }]) {
    const theme = resolveTheme(env);
    assert.equal(theme.icons.prompt, '>');
    assert.equal(theme.icons.separator, '-');
    assert.equal(theme.motion, false);
  }
  assert.equal(resolveTheme({ VERTEX_UI_REDUCED_MOTION: '1' }).motion, false);
  assert.equal(resolveTheme({ INK_SCREEN_READER: 'true' }).motion, false);
});

test('theme preference survives replacement and ignores invalid values', async t => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readThemePreference, saveThemePreference } = await import('../dist/terminal/theme-preference.js');
  const home = mkdtempSync(join(tmpdir(), 'vertex-theme-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  assert.equal(readThemePreference(home), undefined);
  saveThemePreference('warm-light', home);
  assert.equal(readThemePreference(home), 'warm-light');
  saveThemePreference('terminal', home);
  assert.equal(readThemePreference(home), 'terminal');
  writeFileSync(join(home, '.vertex-ui-theme'), 'unknown theme');
  assert.equal(readThemePreference(home), undefined);
});

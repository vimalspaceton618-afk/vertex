import { lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const themeOptions = [
  { name: 'warm-dark', label: 'Warm dark' },
  { name: 'warm-light', label: 'Warm light' },
  { name: 'midnight', label: 'Midnight' },
  { name: 'high-contrast-dark', label: 'High contrast dark' },
  { name: 'high-contrast-light', label: 'High contrast light' },
  { name: 'terminal', label: 'Terminal default (no color)' },
] as const;

export type ThemeName = typeof themeOptions[number]['name'];

export function parseTheme(value: string | undefined): ThemeName | undefined {
  return themeOptions.find(option => option.name === value)?.name;
}

export function readThemePreference(home = homedir()): ThemeName | undefined {
  try {
    const file = join(home, '.vertex-ui-theme');
    const info = lstatSync(file);
    if (!info.isFile() || info.size > 64) return undefined;
    return parseTheme(readFileSync(file, 'utf8').trim());
  } catch {
    return undefined;
  }
}

export function saveThemePreference(theme: ThemeName, home = homedir()) {
  const temporary = mkdtempSync(join(home, '.vertex-theme-'));
  try {
    const file = join(temporary, 'theme');
    writeFileSync(file, theme + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(file, join(home, '.vertex-ui-theme'));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

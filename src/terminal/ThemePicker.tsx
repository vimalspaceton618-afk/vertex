import React from 'react';
import { Box, Text } from 'ink';
import { APP_VERSION_LABEL } from '../version.js';
import { resolveTheme } from './theme.js';
import { themeOptions, type ThemeName } from './theme-preference.js';

import { TerminalThemeProvider } from './ThemeContext.js';
import { ThemePreviewPet } from './VertexPet.js';

export function ThemePicker({ firstRun, selected, width, rows, error }: {
  firstRun: boolean;
  selected: ThemeName;
  width: number;
  rows: number;
  error?: string;
}) {
  const { colors, icons } = resolveTheme({ ...process.env, VERTEX_UI_THEME: selected });
  const artwork = width >= 62 && rows >= 25;
  const petVisible = rows >= 25 && width >= 45 && process.env.VERTEX_UI_PET !== '0'
    && process.env.VERTEX_UI_ASCII !== '1' && process.env.INK_SCREEN_READER !== 'true'
    && process.env.TERM !== 'dumb';

  return (
    <Box flexDirection="column" width={width}>
      <Text bold color={colors.accent}>{firstRun ? 'Welcome to VERTEX' : 'Vertex appearance'} {APP_VERSION_LABEL}</Text>
      {(artwork || petVisible) && (
        <Box justifyContent="space-between" marginY={1}>
          {artwork && (!petVisible || width >= 76) && (
            <Box flexDirection="column">
              <Text color={colors.muted}>{'     .                          *                  .'}</Text>
              <Text color={colors.accent}>{'                  /\\                   /\\'}</Text>
              <Text color={colors.accent}>{'           /\\    /  \\       /\\       /  \\'}</Text>
              <Text color={colors.border}>{'__________/  \\__/    \\_____/  \\_____/    \\____________'}</Text>
            </Box>
          )}
          {petVisible && (
            <TerminalThemeProvider value={colors}>
              <ThemePreviewPet theme={selected} />
            </TerminalThemeProvider>
          )}
        </Box>
      )}
      <Text color={colors.text} bold>Choose a theme</Text>
      {rows >= 16 && <Text color={colors.muted} wrap="truncate-end">Match the theme to your terminal background. Change it later with /theme.</Text>}
      <Box flexDirection="column" marginY={rows >= 18 ? 1 : 0}>
        {themeOptions.map(({ name, label }, i) => (
          <Text key={name} bold={name === selected} color={name === selected ? colors.accent : colors.text} wrap="truncate-end">
            {name === selected ? icons.prompt : ' '} {i + 1}. {label}
          </Text>
        ))}
      </Box>
      {rows >= 18 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={colors.muted}>Diff preview</Text>
          <Text color={colors.error}>- log('Starting')</Text>
          <Text color={colors.success}>+ log('Vertex ready')</Text>
        </Box>
      )}
      <Text color={colors.muted} wrap="truncate-end">Up/Down or 1–6 · Enter save · Esc {firstRun ? 'use default' : 'cancel'}</Text>
      {error && <Text color={colors.error}>{error}</Text>}
    </Box>
  );
}

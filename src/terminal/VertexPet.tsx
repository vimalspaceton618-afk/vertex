import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useTerminalColors } from './ThemeContext.js';
import { motion } from './theme.js';
import type { ThemeName } from './theme-preference.js';

const idle = [
  '  oooooooo  ',
  '  o ooo oo  ',
  'oooooooooooo',
  '  oooooooo  ',
  '  o o  o o  ',
];

const walk = [
  [
    '    oooooo  ',
    '  ooooo oo  ',
    ' ooooooooo  ',
    '  oooooooo  ',
    '   o  oo    ',
  ],
  [
    '   oooooo   ',
    '  oooo oo   ',
    'ooooooooo   ',
    '  ooooooo   ',
    '  oo    oo  ',
  ],
];

const blink = idle.map((row, index) => index === 1 ? '  oooooooo  ' : row);
const lane = 12;

export function petFrame(tick: number, working: boolean, playing: boolean) {
  const phase = tick % (lane * 2);
  const left = phase <= lane ? phase : lane * 2 - phase;
  const moving = working || playing;
  const pose = moving ? walk[tick % walk.length] : tick % 5 === 4 ? blink : idle;
  const rows = pose.map(row => {
    const sprite = moving && phase > lane ? [...row].reverse().join('') : row;
    return ' '.repeat(moving ? left : lane) + sprite;
  });
  if (playing) rows[0] += phase % 2 ? '*' : '+';
  else if (working && tick % 4 === 2) rows[3] += '+';
  return rows;
}

export function VertexPet({ working, interaction, celebrate }: {
  working: boolean;
  interaction: number;
  celebrate: boolean;
}) {
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!motion || (!interaction && !celebrate)) {
      setPlaying(false);
      return;
    }
    setPlaying(true);
    const timer = setTimeout(() => setPlaying(false), 1400);
    return () => clearTimeout(timer);
  }, [interaction, celebrate]);

  useEffect(() => {
    if (!motion || (!working && !playing)) return;
    const timer = setInterval(() => setTick(previous => (previous + 1) % 120), 120);
    timer.unref();
    return () => clearInterval(timer);
  }, [working, playing]);

  if (!working && !playing) return null;
  const rows = petFrame(tick, motion && working, motion && playing);
  return <PetSprite rows={rows} width={lane + idle[0].length + 1} />;
}

export function WelcomePet() {
  return <PetSprite rows={idle} width={idle[0].length} />;
}

const themeFaces = {
  'warm-dark': ['  o ooo oo  ', 'ooooo  ooooo'],
  'warm-light': ['  o  o  oo  ', 'oooo    oooo'],
  midnight: ['  oooooooo  ', 'ooo  oo  ooo'],
  'high-contrast-dark': ['  o oo ooo  ', 'oooooo ooooo'],
  'high-contrast-light': ['  oo ooo o  ', 'ooooo oo ooo'],
  terminal: ['  oo oo oo  ', 'ooooo   oooo'],
} satisfies Record<ThemeName, [string, string]>;

export function themePetFrame(theme: ThemeName, tick: number) {
  const [eyes, mouth] = themeFaces[theme];
  return [
    tick % 4 === 1 ? ' *oooooooo  ' : idle[0],
    eyes,
    mouth,
    idle[3],
    tick % 4 === 2 ? '   o o o o  ' : idle[4],
  ];
}

export function ThemePreviewPet({ theme }: { theme: ThemeName }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!motion) return;
    const timer = setInterval(() => setTick(value => (value + 1) % 4), 450);
    timer.unref();
    return () => clearInterval(timer);
  }, []);
  return <PetSprite rows={themePetFrame(theme, tick)} width={idle[0].length} />;
}

function PetSprite({ rows, width }: { rows: string[]; width: number }) {
  const colors = useTerminalColors();
  return (
    <Box flexDirection="column" alignSelf="flex-end" width={width} aria-hidden>
      {rows.map((row, index) => (
        <Text key={index}>
          {[...row].map((pixel, x) => (
            <Text key={x} color={pixel === 'o' ? colors.accent : colors.warning}>
              {pixel === 'o' ? '█' : pixel === '*' ? '✦' : pixel === '+' ? '·' : ' '}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

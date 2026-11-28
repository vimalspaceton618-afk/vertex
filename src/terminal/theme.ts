type Colors = {
  accent: string;
  text: string;
  muted: string;
  border: string;
  success: string;
  warning: string;
  error: string;
};

const warmDark: Colors = {
  accent: '#D97757', text: '#E6E2DC', muted: '#B0AAA2', border: '#8F8277',
  success: '#8ABF8B', warning: '#E6BD72', error: '#F08080',
};
const warmLight: Colors = {
  accent: '#A4472C', text: '#292622', muted: '#59534C', border: '#746A60',
  success: '#276C37', warning: '#805600', error: '#AF2626',
};

const palettes: Record<string, Colors> = {
  'warm-dark': warmDark,
  'warm-light': warmLight,
  midnight: {
    ...warmDark, accent: '#D78A69', text: '#E5E9F0', muted: '#A6B0BF', border: '#8794A8',
  },
  'high-contrast-dark': {
    accent: '#FFA889', text: '#FFFFFF', muted: '#EEEEEE', border: '#AAAAAA',
    success: '#A4F5AF', warning: '#FFE08A', error: '#FFAAAA',
  },
  'high-contrast-light': {
    accent: '#853210', text: '#000000', muted: '#242424', border: '#595959',
    success: '#005521', warning: '#573600', error: '#910F0F',
  },
};

type ThemeColors = { [Token in keyof Colors]: string | undefined };

const terminalColors: ThemeColors = {
  accent: undefined, text: undefined, muted: undefined, border: undefined,
  success: undefined, warning: undefined, error: undefined,
};

export function resolveTheme(env: NodeJS.ProcessEnv) {
  const requested = env.VERTEX_UI_THEME;
  const useTerminalColors = Object.hasOwn(env, 'NO_COLOR') || env.TERM === 'dumb' || requested === 'terminal';
  const named = requested && Object.hasOwn(palettes, requested) ? palettes[requested] : warmDark;
  const ascii = env.VERTEX_UI_ASCII === '1' || env.TERM === 'dumb';
  return {
    colors: useTerminalColors ? terminalColors : named,
    motion: !ascii && env.VERTEX_UI_REDUCED_MOTION !== '1' && env.INK_SCREEN_READER !== 'true',
    icons: ascii
      ? { prompt: '>', success: '+', error: 'x', waiting: '*', separator: '-' }
      : { prompt: '❯', success: '✓', error: '×', waiting: '·', separator: '─' },
  };
}

export const { colors, icons, motion } = resolveTheme(process.env);

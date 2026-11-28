import { createContext, useContext } from 'react';
import { resolveTheme } from './theme.js';

const ThemeContext = createContext(resolveTheme(process.env).colors);
export const TerminalThemeProvider = ThemeContext.Provider;
export const useTerminalColors = () => useContext(ThemeContext);

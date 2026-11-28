import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, usePaste, useWindowSize, Static, type Key } from 'ink';
import { createStreamPreview } from './terminal/stream-preview.js';
import { nextGrapheme, normalizePaste, previousGrapheme, promptBoundary } from './terminal/prompt-text.js';
import { icons, resolveTheme } from './terminal/theme.js';
import { ThemePicker } from './terminal/ThemePicker.js';
import { TerminalThemeProvider, useTerminalColors } from './terminal/ThemeContext.js';
import { parseTheme, readThemePreference, saveThemePreference, themeOptions, type ThemeName } from './terminal/theme-preference.js';
import { VertexPet } from './terminal/VertexPet.js';
import path from 'path';
import os from 'os';
import type { AgentManager } from './core/agent/AgentManager.js';
import { NcbiFetchTool, UniProtFetchTool, PubChemSearchTool, PubMedSearchTool, ArxivSearchTool } from './tools/ScienceSkills.js';
import { collectHealthStatus, formatHealthReport } from './core/health.js';
import { collectDiagnostics, formatDiagnosticReport } from './core/diagnostics.js';
import { initializeWorkspaceConfig } from './core/setup.js';
import { describeScope } from './core/policy/PolicyEngine.js';
import { SafetyResearchSandboxTool } from './tools/DockerSandbox.js';
import { BrowserAgent } from './agents/BrowserAgent.js';
import { VertexHeader, AgentStatusMonitor, PermissionPrompt, formatApprovalAction, TaskResultSummary, TerminalStatus, getTerminalLayoutWidth, type TaskLifecycleStatus } from './components.js';
import { listWorkspaceSkills, readWorkspaceSkill } from './core/skills/SkillLoader.js';
import { forceSafeMode, getAutonomyMode } from './core/policy/ModeControl.js';

type HistoryMessage = { id: string; role: 'user' | 'assistant'; content: string };
const welcomeBlock = { id: 'welcome', role: 'welcome' } as const;

type ConfirmPrompt = { id: number; message: string; resolve: (value: boolean) => void };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function TrustGate({ trustCursor, width, short }: { trustCursor: number; width: number; short: boolean }) {
  const colors = useTerminalColors();
  if (short || width < 40) {
    return (
      <Box flexDirection="column" width={width}>
        <Text color={colors.accent} bold>Workspace trust</Text>
        <Text>Allow Vertex to read and write this folder and its subdirectories?</Text>
        <Text color={trustCursor === 1 ? colors.accent : colors.muted}>
          {trustCursor === 1 ? '> ' : '  '}1. Trust this workspace
        </Text>
        <Text color={trustCursor === 2 ? colors.accent : colors.muted}>
          {trustCursor === 2 ? '> ' : '  '}2. Exit
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} padding={1} borderStyle="round" borderColor={colors.border}>
      <Text color={colors.accent} bold>VERTEX ISOLATION WARNING</Text>
      <Box marginY={1}>
        <Text color={colors.muted}>
          Vertex requires explicit trust to operate in this directory.
          If granted, Vertex will have read/write access to this folder and subdirectories.
        </Text>
      </Box>
      <Box flexDirection="column">
        <Text color={trustCursor === 1 ? colors.accent : colors.muted}>
          {trustCursor === 1 ? '> ' : '  '}1. Trust this workspace (Enable full access)
        </Text>
        <Text color={trustCursor === 2 ? colors.accent : colors.muted}>
          {trustCursor === 2 ? '> ' : '  '}2. Exit
        </Text>
      </Box>
    </Box>
  );
}

const COMMANDS = [
  { name: '/theme', desc: 'Preview and change the terminal theme' },
  { name: '/help', desc: 'Show available commands and shortcuts' },
  { name: '/clear', desc: 'Clear history' },
  { name: '/health', desc: 'System status report' },
  { name: '/doctor', desc: 'Check environment and local configuration safely' },
  { name: '/init', desc: 'Create a private .env template without overwriting files' },
  { name: '/scope', desc: 'View current policy boundaries' },
  { name: '/exit', desc: 'Quit session' },
  { name: '/sandbox', desc: 'Run command in isolated Docker' },
  { name: '/safe-sandbox', desc: 'Run safety research command in Docker' },
  { name: '/audit', desc: 'Run security audit on path' },
  { name: '/nyx', desc: 'Run NyxAgent security operations' },
  { name: '/phantom', desc: 'Run PhantomAgent red-team workflow' },
  { name: '/sentinel', desc: 'Run SentinelAgent defense workflow' },
  { name: '/recon', desc: 'Run ReconAgent reconnaissance workflow' },
  { name: '/loot', desc: 'Query the encrypted LootStore' },
  { name: '/attack-graph', desc: 'View ATT&CK graph and pivots' },
  { name: '/search', desc: 'Search the web: /search <query>' },
  { name: '/open', desc: 'Open a URL: /open <url>' },
  { name: '/summarize-url', desc: 'Summarize a URL: /summarize-url <url>' },
  { name: '/screenshot-url', desc: 'Save a URL screenshot' },
  { name: '/goal', desc: 'Run a bounded autonomous goal: /goal <task>' },
  { name: '/schedule', desc: 'Schedule a command: /schedule <...>' },
  { name: '/grill-me', desc: 'Interview to clarify task requirements' },
  { name: '/learn', desc: 'Extract and save learned rules' },
  { name: '/skill', desc: 'Query science databases: /skill <...>' },
  { name: '/skills', desc: 'List or inspect local Markdown skills safely' },
  { name: '/mode', desc: 'Show autonomy mode or downgrade to /mode safe' },
  { name: '/gpu', desc: 'Manage GPU jobs: /gpu <action>' }
];

function commandSuggestions(draft: string) {
  return /^\/[a-z0-9_-]*$/i.test(draft)
    ? COMMANDS.filter(command => command.name.startsWith(draft.toLowerCase()))
    : [];
}

function ActiveStreamView({ content, role }: { content: string; role: 'user' | 'assistant' }) {
  const colors = useTerminalColors();
  const MAX_STREAM_LINES = 15;
  const lines = content.split('\n');
  const isTruncated = lines.length > MAX_STREAM_LINES;
  const visibleLines = isTruncated ? lines.slice(-MAX_STREAM_LINES) : lines;
  const displayContent = visibleLines.join('\n');

  return (
    <Box marginY={1} flexDirection="column">
      {isTruncated && (
        <Text color={colors.muted} italic>
          [... {lines.length - MAX_STREAM_LINES} lines active stream ... ]
        </Text>
      )}
      <Text color={role === 'user' ? colors.accent : colors.text}>
        {role === 'user' ? '> ' : ''}{displayContent}
      </Text>
    </Box>
  );
}

function PromptBar({ input, cursor, isStreaming, selectedSuggestionIndex, queuedQueries, width, height }: { input: string, cursor: number, isStreaming: boolean, selectedSuggestionIndex: number, queuedQueries: string[], width: number, height: number }) {
  const colors = useTerminalColors();
  const beforeCursor = input.slice(0, cursor);
  const cursorEnd = nextGrapheme(input, cursor);
  const cursorText = input.slice(cursor, cursorEnd);
  const cursorChar = cursorText && cursorText !== '\n' ? cursorText : ' ';
  const afterCursor = input.slice(cursorText === '\n' ? cursor : cursorEnd);

  const showSuggestions = /^\/[^\s]*$/.test(input);
  const filteredCommands = commandSuggestions(input);
  const menuRows = Math.max(1, Math.min(width < 50 ? 3 : 6, height - 8));
  const firstVisible = Math.max(0, selectedSuggestionIndex + 1 - menuRows);

  return (
    <Box flexDirection="column" width={width}>
      {/* Input Prompt Area */}
      <Box marginTop={1} paddingX={0}>
        <Text bold color={isStreaming ? colors.warning : colors.text}>{icons.prompt + ' '} </Text>
        {input.length > 0 ? (
          <Box>
            <Text>
              <Text>{beforeCursor}</Text>
              <Text inverse>{cursorChar}</Text>
              <Text>{afterCursor}</Text>
            </Text>
          </Box>
        ) : (
          <Box>
            <Text inverse> </Text>
          </Box>
        )}
      </Box>

      {/* Queued queries badge */}
      {queuedQueries.length > 0 && (
        <Box marginTop={0} flexDirection="column">
          <Text color={colors.warning} bold>
            [Queued in waiting ({queuedQueries.length})]:
          </Text>
          {queuedQueries.map((q, idx) => (
            <Text key={`queued-${idx}-${q.slice(0, 10)}`} color={colors.muted}>
              {"  "}{idx + 1}. {q.length > 110 ? `${q.slice(0, 107)}…` : q}
            </Text>
          ))}
        </Box>
      )}

      {/* Bottom Divider */}
      <Box marginTop={0}>
        <Text color={colors.muted}>{icons.separator.repeat(Math.max(1, width - 1))}</Text>
      </Box>

      {/* Dynamic Suggestions or Help */}
      <Box marginTop={0} flexDirection="column">
        {showSuggestions ? (
          <Box flexDirection="column" borderStyle={icons.prompt === '>' ? 'classic' : 'round'} borderColor={colors.border} paddingX={width >= 30 ? 1 : 0}>
            <Text color={colors.muted} wrap="truncate-end">COMMAND PALETTE · ↑/↓ select · Tab complete</Text>
            {filteredCommands.length > 0 ? (
              filteredCommands.slice(firstVisible, firstVisible + menuRows).map((cmd, index) => {
                const idx = index + firstVisible;
                return (
                  <Box key={cmd.name} flexDirection="row">
                    <Box width={20}>
                      <Text color={idx === selectedSuggestionIndex ? colors.success : colors.accent} bold={idx === selectedSuggestionIndex}>
                        {idx === selectedSuggestionIndex ? '› ' : '  '}{cmd.name}
                      </Text>
                    </Box>
                    {width >= 50 && <Box flexGrow={1}>
                      <Text color={idx === selectedSuggestionIndex ? colors.text : colors.muted} wrap="truncate-end">{cmd.desc}</Text>
                    </Box>}
                  </Box>
                );
              })
            ) : (
              <Text color={colors.warning}>No command matches “{input}”. Try /help to see available commands.</Text>
            )}
          </Box>
        ) : input.startsWith('?') ? (
          <Text color={colors.accent}>KEYBOARD · Enter run · Tab/↑/↓ select command · ↑/↓ history · ←/→ edit · Ctrl+A/E start/end · Ctrl+U clear · Esc cancel/clear · Ctrl+C exit</Text>
        ) : isStreaming ? (
          <Text color={colors.warning}>RUNNING · Esc cancels current task · Enter queues the next task · {queuedQueries.length} queued</Text>
        ) : (
          <Text color={colors.muted}>Enter run · Ctrl+J newline · / commands</Text>
        )}
      </Box>
    </Box>
  );
}

function App() {
  const [startup] = useState(() => {
    const preferred = parseTheme(process.env.VERTEX_UI_THEME) ?? readThemePreference();
    return {
      theme: preferred ?? 'warm-dark' as ThemeName,
      firstRun: !preferred && Boolean(process.stdin.isTTY && process.stdout.isTTY) && process.env.TERM !== 'dumb',
    };
  });
  const [theme, setTheme] = useState(startup.theme);
  const palette = resolveTheme({ ...process.env, VERTEX_UI_THEME: theme }).colors;
  return (
    <TerminalThemeProvider value={palette}>
      <VertexSession theme={theme} setTheme={setTheme} firstRun={startup.firstRun} />
    </TerminalThemeProvider>
  );
}

function VertexSession({ theme, setTheme, firstRun }: {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  firstRun: boolean;
}) {
  const colors = useTerminalColors();
  const [themePicker, setThemePicker] = useState<'startup' | 'command' | null>(firstRun ? 'startup' : null);
  const [themeIndex, setThemeIndex] = useState(() => themeOptions.findIndex(option => option.name === theme));
  const [themeError, setThemeError] = useState<string>();
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const layoutWidth = getTerminalLayoutWidth(columns);
  const short = rows < 12;
  const showPet = columns >= 50 && rows >= 18 && process.env.VERTEX_UI_PET !== '0'
    && process.env.VERTEX_UI_ASCII !== '1' && process.env.INK_SCREEN_READER !== 'true'
    && process.env.TERM !== 'dumb';
  const [petInteraction, setPetInteraction] = useState(0);
  const [isTrusted, setIsTrusted] = useState(false);
  const [trustCursor, setTrustCursor] = useState(firstRun ? 2 : 1);
  const [input, setInput] = useState('');
  const [inputCursor, setInputCursor] = useState(0);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const savedDraft = useRef({ text: '', cursor: 0 });
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [taskStage, setTaskStage] = useState<TaskLifecycleStatus | 'idle'>('idle');
  const [taskLabel, setTaskLabel] = useState('');
  const [taskStartedAt, setTaskStartedAt] = useState(0);
  const [taskDurationMs, setTaskDurationMs] = useState(0);
  const [queuedQueries, setQueuedQueries] = useState<string[]>([]);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);
  const nextApprovalId = useRef(0);
  const [autoApproveTools] = useState(false);

  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);

  const orchestratorRef = useRef<AgentManager | null>(null);
  const getOrchestrator = async (): Promise<AgentManager> => {
    if (orchestratorRef.current) return orchestratorRef.current;
    const { AgentManager } = await import('./core/agent/AgentManager.js');
    const instance = new AgentManager();
    orchestratorRef.current = instance;
    return instance;
  };
  const autoApproveToolsRef = useRef(false);
  const currentAbortController = useRef<AbortController | null>(null);
  const activeAssistantId = useRef<string | undefined>(undefined);
  const activePreview = useRef<ReturnType<typeof createStreamPreview> | undefined>(undefined);

  useEffect(() => () => activePreview.current?.cancel(), []);

  useEffect(() => {
    autoApproveToolsRef.current = autoApproveTools;
  }, [autoApproveTools]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [input]);

  useEffect(() => {
    if (!isStreaming && queuedQueries.length > 0) {
      const [nextQuery, ...remaining] = queuedQueries;
      setQueuedQueries(remaining);
      handlePrompt(nextQuery);
    }
  }, [isStreaming, queuedQueries]);

  const cancelCurrentTask = () => {
    if (currentAbortController.current) {
      currentAbortController.current.abort();
      currentAbortController.current = null;
    }
    activePreview.current?.flush();
    activePreview.current = undefined;
    const assistantId = activeAssistantId.current;
    if (assistantId) {
      updateAssistant(assistantId, text => [text, '[CANCELLED: Task interrupted by user via Esc]'].filter(Boolean).join('\n'));
    }
    activeAssistantId.current = undefined;
    setQueuedQueries([]);
    setTaskStage('cancelled');
    setTaskLabel('Task cancelled by user');
    setIsStreaming(false);
  };

  const setPromptValue = (value: string, cursor = value.length) => {
    setInput(value);
    setInputCursor(promptBoundary(value, clamp(cursor, 0, value.length)));
  };

  const pushPromptHistory = (query: string) => {
    setPromptHistory((previous) => {
      const withoutDuplicateTail = previous[previous.length - 1] === query ? previous.slice(0, -1) : previous;
      return [...withoutDuplicateTail, query].slice(-80);
    });
    setHistoryCursor(null);
  };

  const appendTurn = (query: string, response = '') => {
    const userMsgId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const assistantMsgId = `assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setHistory((previous) => [
      ...previous,
      { id: userMsgId, role: 'user', content: query },
      { id: assistantMsgId, role: 'assistant', content: response }
    ]);
    return assistantMsgId;
  };

  const updateAssistant = (id: string, update: string | ((text: string) => string)) => {
    setHistory(previous => {
      const index = previous.findIndex(message => message.id === id);
      if (index < 0) return previous;
      const message = previous[index];
      const content = typeof update === 'string' ? update : update(message.content);
      if (message.content === content) return previous;
      const updated = previous.slice();
      updated[index] = { ...message, content };
      return updated;
    });
  };

  const makeConfirm = () => (message: string) => {
    if (autoApproveToolsRef.current) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      setConfirmPrompt({
        id: ++nextApprovalId.current,
        message,
        resolve: (value) => {
          resolve(value);
        }
      });
    });
  };

  const runDelegatedStream = async (query: string, routedPrompt = query) => {
    const controller = new AbortController();
    const startedAt = Date.now();
    currentAbortController.current = controller;
    const assistantId = appendTurn(query);
    activeAssistantId.current = assistantId;
    setPromptValue('');
    setTaskLabel(query.length > 72 ? query.slice(0, 69) + '…' : query);
    setTaskStartedAt(startedAt);
    setTaskDurationMs(0);
    setTaskStage('starting');
    setIsStreaming(true);

    const preview = createStreamPreview(text => updateAssistant(assistantId, text));
    activePreview.current = preview;
    let fullText = '';
    try {
      let useDaemon = false;
      try {
        const statusCheck = await fetch('http://127.0.0.1:8899/status', { signal: controller.signal });
        if (statusCheck.ok) {
          const json = await statusCheck.json();
          if (json && json.status === 'running') {
            useDaemon = true;
          }
        }
      } catch {
        // Silent fallback
      }

      if (controller.signal.aborted) return;
      setTaskStage('running');
      if (useDaemon) {
        const response = await fetch('http://127.0.0.1:8899/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: routedPrompt, autoApprove: false }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Daemon execution failed with status ${response.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Daemon stream returned empty body.');
        const decoder = new TextDecoder();
        while (true) {
          if (controller.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done || controller.signal.aborted) break;
          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          preview.update(fullText);
        }
        if (!controller.signal.aborted) fullText += decoder.decode();
      } else {
        const orchestrator = await getOrchestrator();
        const stream = orchestrator.delegateTask(routedPrompt, message => {
          if (controller.signal.aborted) return Promise.resolve(false);
          preview.flush();
          return makeConfirm()(message);
        }, controller.signal);
        for await (const chunk of stream) {
          if (controller.signal.aborted) break;
          fullText += chunk;
          preview.update(fullText);
        }
        if (!controller.signal.aborted) {
          orchestrator.recordTurn(query, fullText);
        }
      }
      if (!controller.signal.aborted) setTaskStage('completed');
    } catch (error: any) {
      if (currentAbortController.current === controller) {
        if (error.name === 'AbortError' || controller.signal.aborted) {
          fullText += '\n[CANCELLED: Task interrupted by user via Esc]';
          setTaskStage('cancelled');
          setTaskLabel('Task cancelled by user');
        } else {
          const message = error instanceof Error ? error.message : String(error);
          fullText = [fullText, `[VERTEX ERROR] ${message}`].filter(Boolean).join('\n');
          setTaskStage('failed');
          setTaskLabel(message.length > 72 ? message.slice(0, 69) + '…' : message);
        }
      }
    } finally {
      preview.cancel();
      if (currentAbortController.current === controller) {
        updateAssistant(assistantId, fullText);
        currentAbortController.current = null;
        activeAssistantId.current = undefined;
        activePreview.current = undefined;
        setTaskDurationMs(Date.now() - startedAt);
        setIsStreaming(false);
      }
    }
  };

  const runImmediateTask = (query: string, task: () => Promise<string>) => {
    const controller = new AbortController();
    const startedAt = Date.now();
    currentAbortController.current = controller;
    setPromptValue('');
    const assistantId = appendTurn(query);
    activeAssistantId.current = assistantId;
    setTaskLabel(query.length > 72 ? query.slice(0, 69) + '…' : query);
    setTaskStartedAt(startedAt);
    setTaskDurationMs(0);
    setTaskStage('starting');
    setIsStreaming(true);
    void (async () => {
      try {
        setTaskStage('running');
        const result = await task();
        if (!controller.signal.aborted) {
          updateAssistant(assistantId, result);
          orchestratorRef.current?.recordTurn(query, result);
          setTaskStage('completed');
        }
      } catch (error: any) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          updateAssistant(assistantId, `[VERTEX ERROR] ${message}`);
          setTaskStage('failed');
          setTaskLabel(message.length > 72 ? message.slice(0, 69) + '…' : message);
        }
      } finally {
        if (currentAbortController.current === controller) {
          currentAbortController.current = null;
          activeAssistantId.current = undefined;
          setTaskDurationMs(Date.now() - startedAt);
          setIsStreaming(false);
        }
      }
    })();
  };

  const handlePrompt = (query: string) => {
    const trimmedQuery = query.trim();
    const isShellEscape = trimmedQuery.startsWith('!') || trimmedQuery.startsWith('$');
    const rawCmd = isShellEscape ? trimmedQuery.slice(1).trim() : trimmedQuery;
    const cmdTokens = rawCmd.split(/\s+/);
    const primaryCmd = cmdTokens[0]?.toLowerCase();

    const standardBinaries = [
      'ls', 'pwd', 'git', 'cat', 'grep', 'mkdir', 'rm', 'cd',
      'ping', 'ipconfig', 'ifconfig', 'whoami', 'netstat', 'uname', 'dir'
    ];
    const isDirectCmd = isShellEscape || standardBinaries.includes(primaryCmd);

    if (isDirectCmd) {
      setPromptValue('');
      if (primaryCmd === 'clear') {
        setHistory([]);
        orchestratorRef.current?.clearHistory();
        process.stdout.write('\x1Bc');
        return;
      }
      if (primaryCmd === 'cd') {
        const targetDir = cmdTokens.slice(1).join(' ').trim() || os.homedir();
        runImmediateTask(query, async () => {
          try {
            const resolved = path.resolve(process.cwd(), targetDir);
            process.chdir(resolved);
            process.env.VERTEX_WORKSPACE_ROOT = resolved;
            return `Changed directory to: ${resolved}`;
          } catch (e: any) {
            return `[CD ERROR]: ${e.message}`;
          }
        });
        return;
      }
      runImmediateTask(query, async () => {
        const { exec: execCb } = await import('child_process');
        const { promisify: prom } = await import('util');
        const execP = prom(execCb);
        try {
          const { stdout, stderr } = await execP(rawCmd, {
            cwd: process.cwd(),
            timeout: 30000,
            maxBuffer: 1024 * 1024
          });
          const out = stdout.trim();
          const err = stderr.trim();
          return out + (err ? `\nSTDERR: ${err}` : '') || 'Command completed successfully.';
        } catch (e: any) {
          return `[SHELL ERROR]: ${e.message}\n${e.stderr || ''}`;
        }
      });
      return;
    }

    const lowerQuery = query.toLowerCase();

    if (lowerQuery === '/theme') {
      setPromptValue('');
      setThemeIndex(themeOptions.findIndex(option => option.name === theme));
      setThemeError(undefined);
      setThemePicker('command');
      return;
    }

    const missingArgumentUsage: Record<string, string> = {
      '/phantom': 'Usage: /phantom <red team prompt>\nExample: /phantom run full kill-chain on 192.168.1.50',
      '/recon': 'Usage: /recon <target>\nExample: /recon scan and enumerate subdomains for target.com',
      '/nyx': 'Usage: /nyx <offensive security prompt>\nExample: /nyx scan 192.168.1.0/24 with nmap service detection',
      '/search': 'Usage: /search <query>\nExample: /search kali linux nmap nse scripts',
      '/open': 'Usage: /open <url>',
      '/summarize-url': 'Usage: /summarize-url <url>',
      '/screenshot-url': 'Usage: /screenshot-url <url> [filePath]',
      '/goal': 'Usage: /goal <objective>',
      '/schedule': 'Usage: /schedule <seconds> <command>\nExample: /schedule 30 /health',
      '/skill': 'Usage: /skill <ncbi|uniprot|pubchem|pubmed|arxiv> <query>',
      '/safe-sandbox': 'Usage: /safe-sandbox [--image alpine:latest|python:3.12-alpine|node:22-alpine] <command>',
      '/sandbox': 'Usage: /sandbox <shell command>\nExample: /sandbox ls -la'
    };
    if (Object.prototype.hasOwnProperty.call(missingArgumentUsage, lowerQuery)) {
      setPromptValue('');
      appendTurn(query, missingArgumentUsage[lowerQuery]);
      return;
    }

    if (lowerQuery === '?' || lowerQuery === '/?') {
      setPromptValue('');
      appendTurn(query, 'Shortcuts:\n? - Show shortcuts\n/ - List commands\nCtrl+C - Exit\nUp/Down Arrow - Navigate history\nLeft/Right Arrow - Move cursor' + (showPet ? '\nCtrl+P - Play with the Vertex pet' : ''));
      return;
    }

    if (lowerQuery === '/' || lowerQuery === 'help' || lowerQuery === '/help') {
      setPromptValue('');
      appendTurn(query, [
        'VERTEX COMMANDS',
        '',
        ...COMMANDS.map((cmd) => `${cmd.name.padEnd(16)} ${cmd.desc}`),
        '',
        'Tip: type / followed by a few letters to filter commands. Use ↑/↓ to select, Tab to complete, then Enter to run.',
        'Use ? to view keyboard shortcuts.'
      ].join('\n'));
      return;
    }

    if (lowerQuery === '/clear' || lowerQuery === 'clear') {
      setPromptValue('');
      setHistory([]);
      orchestratorRef.current?.clearHistory();
      process.stdout.write('\x1Bc');
      return;
    }

    if (lowerQuery === 'exit' || lowerQuery === 'quit' || lowerQuery === '/exit' || lowerQuery === '/quit') {
      exit();
      return;
    }

    if (lowerQuery === '/doctor') {
      setPromptValue('');
      appendTurn(query, formatDiagnosticReport(collectDiagnostics()));
      return;
    }

    if (lowerQuery === '/init') {
      setPromptValue('');
      try {
        const result = initializeWorkspaceConfig(process.cwd());
        appendTurn(query, result.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendTurn(query, `[INIT ERROR] ${message}`);
      }
      return;
    }

    if (lowerQuery === '/health') {
      setPromptValue('');
      const status = collectHealthStatus();
      appendTurn(query, formatHealthReport(status));
      return;
    }

    if (lowerQuery === '/scope' || lowerQuery === '/scope show') {
      setPromptValue('');
      appendTurn(query, describeScope());
      return;
    }

    if (lowerQuery.startsWith('/phantom ')) {
      const p = query.slice('/phantom '.length).trim();
      if (!p) {
        setPromptValue('');
        appendTurn(query, 'Usage: /phantom <red team prompt>\nExample: /phantom run full kill-chain on 192.168.1.50');
        return;
      }
      runDelegatedStream(query, `[ROUTE_DIRECT:PhantomAgent] ${p}`);
      return;
    }

    if (lowerQuery.startsWith('/sentinel')) {
      const p = query.slice('/sentinel'.length).trim() || 'run full defensive audit and timeline analysis';
      runDelegatedStream(query, `[ROUTE_DIRECT:SentinelAgent] ${p}`);
      return;
    }

    if (lowerQuery.startsWith('/recon ')) {
      const p = query.slice('/recon '.length).trim();
      if (!p) {
        setPromptValue('');
        appendTurn(query, 'Usage: /recon <target>\nExample: /recon scan and enumerate subdomains for target.com');
        return;
      }
      runDelegatedStream(query, `[ROUTE_DIRECT:ReconAgent] ${p}`);
      return;
    } else if (lowerQuery.startsWith('/loot')) {
      const arg = query.slice('/loot'.length).trim().toLowerCase();
      setPromptValue('');
      runImmediateTask(query, async () => {
        const { getLootStore } = await import('./core/LootStore.js');
        const store = getLootStore();
        if (arg === 'stats') return store.getStats();
        if (arg === 'export') return store.exportJson();
        if (arg === 'hashcat') return store.exportHashcat() || 'No hashes in vault.';
        return store.query({ target: arg || undefined });
      });
      return;
    } else if (lowerQuery.startsWith('/attack-graph')) {
      setPromptValue('');
      runImmediateTask(query, async () => {
        const { getAttackGraph } = await import('./core/AttackGraph.js');
        const graph = getAttackGraph();
        return graph.planNextPhase();
      });
      return;
    }

    if (lowerQuery.startsWith('/search ')) {
      const searchQuery = query.slice('/search '.length).trim();
      if (!searchQuery) {
        setPromptValue('');
        appendTurn(query, 'Usage: /search <query>\nExample: /search kali linux nmap nse scripts');
        return;
      }
      runImmediateTask(query, () => new BrowserAgent().searchDuckDuckGo(searchQuery));
      return;
    }

    if (lowerQuery.startsWith('/open ')) {
      const url = query.slice('/open '.length).trim();
      if (!url) {
        setPromptValue('');
        appendTurn(query, 'Usage: /open <url>');
        return;
      }
      runImmediateTask(query, () => new BrowserAgent().navigateUrl(url));
      return;
    }

    if (lowerQuery.startsWith('/summarize-url ')) {
      const url = query.slice('/summarize-url '.length).trim();
      if (!url) {
        setPromptValue('');
        appendTurn(query, 'Usage: /summarize-url <url>');
        return;
      }
      runImmediateTask(query, () => new BrowserAgent().summarizeUrl(url));
      return;
    }

    if (lowerQuery.startsWith('/screenshot-url ')) {
      const parts = query.slice('/screenshot-url '.length).trim().split(/\s+/);
      const url = parts[0] || '';
      const filePath = parts[1] || `artifacts/screenshots/screenshot-${Date.now()}.png`;
      if (!url) {
        setPromptValue('');
        appendTurn(query, 'Usage: /screenshot-url <url> [filePath]');
        return;
      }
      runImmediateTask(query, () => new BrowserAgent().screenshotUrl(url, filePath));
      return;
    }

    if (lowerQuery.startsWith('/goal ')) {
      const goal = query.slice('/goal '.length).trim();
      if (!goal) {
        setPromptValue('');
        appendTurn(query, 'Usage: /goal <objective>');
        return;
      }
      runDelegatedStream(query, `Run autonomously and completely finish this objective: ${goal}`);
      return;
    }

    if (lowerQuery.startsWith('/schedule ')) {
      const scheduleArgs = query.slice('/schedule '.length).trim();
      const parts = scheduleArgs.match(/^(\d+)\s+(.+)$/);
      if (!parts) {
        setPromptValue('');
        appendTurn(query, 'Usage: /schedule <seconds> <command>\nExample: /schedule 30 /health');
        return;
      }
      const timeArg = parts[1];
      const cmdToRun = parts[2];
      const seconds = parseInt(timeArg);

      setPromptValue('');
      if (isNaN(seconds) || seconds <= 0) {
        appendTurn(query, '[SCHEDULE ERROR]: Only integer seconds are supported.');
        return;
      }

      appendTurn(query, `Scheduled job: executing "${cmdToRun}" every ${seconds} seconds.`);
      const intervalId = setInterval(() => {
        handlePrompt(cmdToRun);
      }, seconds * 1000);

      (global as any).vertexTimers = (global as any).vertexTimers || [];
      (global as any).vertexTimers.push({ id: intervalId, cmd: cmdToRun, sec: seconds });
      return;
    }

    if (lowerQuery === '/grill-me') {
      runDelegatedStream(query, 'Start an interactive interview with me to align on our plan. Ask me up to 3 clarifying questions one-by-one to probe for requirements, constraints, and architecture.');
      return;
    }

    if (lowerQuery === '/learn') {
      runDelegatedStream(query, 'Analyze the conversation history. Extract any lessons, rules, guidelines, or reusable patterns we established, and save them in markdown format to ~/.vertex/learned_rules.md.');
      return;
    }

    if (lowerQuery === '/mode' || lowerQuery === '/mode safe') {
      setPromptValue('');
      if (lowerQuery === '/mode safe') {
        const mode = forceSafeMode();
        appendTurn(query, `Autonomy mode set to ${mode} for this process. This is a safety downgrade; it does not enable unrestricted execution.`);
      } else {
        const mode = getAutonomyMode();
        appendTurn(query, `Current autonomy mode: ${mode}. Use /mode safe to downgrade to semi_auto. Enabling full_auto_lab requires explicit configuration outside the interactive UI.`);
      }
      return;
    }

    if (lowerQuery === '/skills' || lowerQuery.startsWith('/skills show ')) {
      setPromptValue('');
      try {
        if (lowerQuery.startsWith('/skills show ')) {
          const skillName = query.slice('/skills show '.length).trim();
          if (!skillName) {
            appendTurn(query, 'Usage: /skills show <name>');
            return;
          }
          const skillText = readWorkspaceSkill(skillName);
          appendTurn(query, `[LOCAL SKILL: ${skillName}]\nUntrusted Markdown content only; VERTEX does not execute skill files.\n\n${skillText}`);
          return;
        }
        const skills = listWorkspaceSkills();
        if (skills.length === 0) {
          appendTurn(query, 'No local Markdown skills found. Add trusted files as .vertex/skills/<name>.md (max 64 KiB each). Files are treated as data, not executable code.');
          return;
        }
        appendTurn(query, 'Local Markdown skills (read-only; not executed):\n' + skills.map((skill) => `- ${skill.name} (${skill.bytes} bytes)`).join('\n') + '\nUse /skills show <name> to inspect a file.');
      } catch (error) {
        appendTurn(query, `[SKILL LOADER ERROR]: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    if (lowerQuery.startsWith('/skill ')) {
      const skillArgs = query.slice('/skill '.length).trim();
      const skillParts = skillArgs.split(/\s+/);
      const skillName = skillParts[0]?.toLowerCase();
      const skillParam = skillParts.slice(1).join(' ');

      if (!skillName || !skillParam) {
        setPromptValue('');
        appendTurn(query, 'Usage: /skill <ncbi|uniprot|pubchem|pubmed|arxiv> <query>');
        return;
      }

      if (skillName === 'ncbi') {
        runImmediateTask(query, () => new NcbiFetchTool().execute({ id: skillParam }));
        return;
      }
      if (skillName === 'uniprot') {
        runImmediateTask(query, () => new UniProtFetchTool().execute({ accession: skillParam }));
        return;
      }
      if (skillName === 'pubchem') {
        runImmediateTask(query, () => new PubChemSearchTool().execute({ name: skillParam }));
        return;
      }
      if (skillName === 'pubmed') {
        runImmediateTask(query, () => new PubMedSearchTool().execute({ query: skillParam }));
        return;
      }
      if (skillName === 'arxiv') {
        runImmediateTask(query, () => new ArxivSearchTool().execute({ query: skillParam }));
        return;
      }

      setPromptValue('');
      appendTurn(query, `Unknown skill: ${skillName}. Choose from: ncbi, uniprot, pubchem, pubmed, arxiv.`);
      return;
    }

    if (lowerQuery.startsWith('/gpu')) {
      const gpuArgs = query.slice(4).trim();
      const gpuParts = gpuArgs.split(/\s+/);
      const subCmd = (gpuParts[0] || 'help').toLowerCase();

      if (subCmd === 'help' || !subCmd) {
        setPromptValue('');
        appendTurn(query, 'GPU Commands:\n/gpu deploy <script> [--gpu <model>] [--provider <name>] [--image <img>]\n/gpu status [instanceId]\n/gpu list [provider]\n/gpu logs <instanceId>\n/gpu destroy <instanceId>\n/gpu ssh <instanceId> <command>');
        return;
      }

      if (subCmd === 'deploy') {
        const scriptParts = gpuParts.slice(1);
        let gpu = 'a100', provider = 'auto', image = 'pytorch/pytorch:latest', script = '';
        const scriptTokens: string[] = [];
        for (let i = 0; i < scriptParts.length; i++) {
          if (scriptParts[i] === '--gpu' && scriptParts[i+1]) { gpu = scriptParts[++i]; }
          else if (scriptParts[i] === '--provider' && scriptParts[i+1]) { provider = scriptParts[++i]; }
          else if (scriptParts[i] === '--image' && scriptParts[i+1]) { image = scriptParts[++i]; }
          else { scriptTokens.push(scriptParts[i]); }
        }
        script = scriptTokens.join(' ');
        if (!script) { setPromptValue(''); appendTurn(query, 'Usage: /gpu deploy <script> [--gpu a100] [--provider runpod]'); return; }
        runDelegatedStream(query, `Deploy a GPU job on provider "${provider}" with GPU "${gpu}" using image "${image}". Script to run: ${script}`);
        return;
      }

      if (subCmd === 'status') {
        const instanceId = gpuParts[1] || '';
        runDelegatedStream(query, instanceId
          ? `Check the status of GPU instance ${instanceId}`
          : 'List all active GPU jobs and their current status');
        return;
      }

      if (subCmd === 'list') {
        const providerName = gpuParts[1] || 'auto';
        runDelegatedStream(query, `List available GPU types and pricing from provider: ${providerName}`);
        return;
      }

      if (subCmd === 'logs') {
        const instanceId = gpuParts[1];
        if (!instanceId) { setPromptValue(''); appendTurn(query, 'Usage: /gpu logs <instanceId>'); return; }
        runDelegatedStream(query, `Stream logs from GPU instance ${instanceId}`);
        return;
      }

      if (subCmd === 'destroy') {
        const instanceId = gpuParts[1];
        if (!instanceId) { setPromptValue(''); appendTurn(query, 'Usage: /gpu destroy <instanceId>'); return; }
        runDelegatedStream(query, `Terminate and destroy GPU instance ${instanceId}`);
        return;
      }

      if (subCmd === 'ssh') {
        const instanceId = gpuParts[1];
        const remoteCmd = gpuParts.slice(2).join(' ');
        if (!instanceId || !remoteCmd) { setPromptValue(''); appendTurn(query, 'Usage: /gpu ssh <instanceId> <command>'); return; }
        runDelegatedStream(query, `Execute command on GPU instance ${instanceId} via SSH: ${remoteCmd}`);
        return;
      }

      // Unknown subcommand — delegate to orchestrator
      runDelegatedStream(query, `GPU operation: ${gpuArgs}`);
      return;
    }

    if (lowerQuery.startsWith('/safe-sandbox ')) {
      const raw = query.slice('/safe-sandbox '.length).trim();
      const imageMatch = raw.match(/^--image\s+(\S+)\s+([\s\S]+)$/);
      const image = imageMatch?.[1];
      const command = (imageMatch?.[2] || raw).trim();
      if (!command) {
        setPromptValue('');
        appendTurn(query, 'Usage: /safe-sandbox [--image alpine:latest|python:3.12-alpine|node:22-alpine] <command>');
        return;
      }
      runImmediateTask(query, () => new SafetyResearchSandboxTool().execute({ command, image }, makeConfirm()));
      return;
    }

    if (lowerQuery.startsWith('/sandbox ')) {
      const sandboxCmd = query.slice('/sandbox '.length).trim();
      if (!sandboxCmd) {
        setPromptValue('');
        appendTurn(query, 'Usage: /sandbox <shell command>\nExample: /sandbox ls -la');
        return;
      }
      const prompt = `Use the sandbox_execute tool to run the following command in an isolated Docker container and return the output. Command: ${sandboxCmd}`;
      void runDelegatedStream(query, `[ROUTE_DIRECT:CyberAgent] ${prompt}`);
      return;
    }

    if (lowerQuery.startsWith('/audit')) {
      const auditPath = query.slice('/audit'.length).trim() || process.cwd();
      const prompt = [
        `Perform a comprehensive security audit on this path: ${auditPath}`,
        'Run the following checks in sequence:',
        '1. Scan for exposed secrets using env_secrets_scan',
        '2. Run file_integrity on the target path',
        '3. Run network_audit to inspect active connections',
        '4. Run process_inspect to list suspicious processes',
        '5. Compile a structured EXECUTIVE SUMMARY with a FINDINGS TABLE and RECOMMENDATIONS.'
      ].join('\n');
      void runDelegatedStream(query, `[ROUTE_DIRECT:CyberAgent] ${prompt}`);
      return;
    }

    if (lowerQuery.startsWith('/nyx ')) {
      const nyxPrompt = query.slice('/nyx '.length).trim();
      if (!nyxPrompt) {
        setPromptValue('');
        appendTurn(query, 'Usage: /nyx <offensive security prompt>\nExample: /nyx scan 192.168.1.0/24 with nmap service detection and vuln scripts');
        return;
      }
      void runDelegatedStream(query, `[ROUTE_DIRECT:NyxAgent] ${nyxPrompt}`);
      return;
    }

    void runDelegatedStream(query);
  };

  const submitPrompt = (value: string) => {
    const query = value.trim();
    if (!query || isStreaming) return;
    pushPromptHistory(query);
    handlePrompt(query);
  };

  const recallPromptHistory = (direction: -1 | 1) => {
    if (promptHistory.length === 0) return;
    if (direction === -1) {
      if (historyCursor === null) savedDraft.current = { text: input, cursor: inputCursor };
      const nextIndex = historyCursor === null ? promptHistory.length - 1 : Math.max(0, historyCursor - 1);
      setHistoryCursor(nextIndex);
      setPromptValue(promptHistory[nextIndex]);
      return;
    }
    if (historyCursor === null) return;
    const nextIndex = historyCursor + 1;
    if (nextIndex >= promptHistory.length) {
      setHistoryCursor(null);
      setPromptValue(savedDraft.current.text, savedDraft.current.cursor);
      return;
    }
    setHistoryCursor(nextIndex);
    setPromptValue(promptHistory[nextIndex]);
  };

  const insertPromptText = (text: string) => {
    setPromptValue(input.slice(0, inputCursor) + text + input.slice(inputCursor), inputCursor + text.length);
  };

  const handleCharInput = (char: string, key: Key) => {
    if (key.ctrl && char === 'c') {
      exit();
      return;
    }

    if (themePicker && !confirmPrompt) {
      if (key.eventType === 'repeat' || key.eventType === 'release') return;
      if (key.escape && themePicker === 'command') {
        setThemePicker(null);
      } else if (key.return || key.escape) {
        const selected = key.escape ? theme : themeOptions[themeIndex].name;
        if (!key.escape) {
          try {
            saveThemePreference(selected);
          } catch {
            setThemeError('Could not save the theme. Esc continues without saving.');
            return;
          }
        }
        setTheme(selected);
        setThemePicker(null);
      } else if (key.upArrow || key.downArrow) {
        setThemeIndex(index => (index + (key.downArrow ? 1 : -1) + themeOptions.length) % themeOptions.length);
      } else if (/^[1-6]$/.test(char)) {
        setThemeIndex(Number(char) - 1);
      }
      return;
    }

    if (!isTrusted) {
      if (char === '1' || (key.return && trustCursor === 1)) {
        process.env.VERTEX_WORKSPACE_ROOT = process.cwd();
        setIsTrusted(true);
      } else if (char === '2' || (key.return && trustCursor === 2) || key.escape) {
        exit();
      } else if (key.upArrow) {
        setTrustCursor(1);
      } else if (key.downArrow) {
        setTrustCursor(2);
      }
      return;
    }

    if (confirmPrompt) {
        return;
    }

    if (showPet && key.ctrl && char === 'p') {
      setPetInteraction(previous => previous + 1);
      return;
    }

    const showSuggestions = /^\/[^\s]*$/.test(input);
    const filteredCommands = commandSuggestions(input);

    if (key.tab && filteredCommands.length > 0) {
      const completed = filteredCommands[selectedSuggestionIndex]?.name;
      if (completed) setPromptValue(completed);
      return;
    }

    if ((key.return && (key.shift || key.meta)) || (key.ctrl && char === 'j')) {
      insertPromptText('\n');
      return;
    }

    if (key.return) {
      const verb = input.trim().match(/^(\/[a-z][a-z0-9_-]*)(?=[ \t]|$)/i)?.[1].toLowerCase();
      if (verb && verb !== '/quit' && !COMMANDS.some(command => command.name === verb)) {
        if (filteredCommands.length === 0) {
          appendTurn(input, 'Unknown command. Type /help to see available commands.');
        }
        return;
      }
      if (input.trim().length > 0) {
        if (isStreaming) {
          const q = input.trim();
          pushPromptHistory(q);
          setQueuedQueries((prev) => [...prev, q]);
          setPromptValue('');
        } else {
          submitPrompt(input);
        }
      }
      return;
    }

    if (key.escape) {
      if (input.length > 0) {
        setPromptValue('');
      } else if (isStreaming) {
        cancelCurrentTask();
      }
      return;
    }

    if (key.upArrow) {
      if (showSuggestions && filteredCommands.length > 0) {
        setSelectedSuggestionIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      recallPromptHistory(-1);
      return;
    }

    if (key.downArrow) {
      if (showSuggestions && filteredCommands.length > 0) {
        setSelectedSuggestionIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      recallPromptHistory(1);
      return;
    }

    if (key.leftArrow) {
      setInputCursor((current) => previousGrapheme(input, current));
      return;
    }

    if (key.rightArrow) {
      setInputCursor((current) => nextGrapheme(input, current));
      return;
    }

    if (key.home || (key.ctrl && char === 'a')) {
      setInputCursor(inputCursor === 0 ? 0 : input.lastIndexOf('\n', inputCursor - 1) + 1);
      return;
    }

    if (key.end || (key.ctrl && char === 'e')) {
      const end = input.indexOf('\n', inputCursor);
      setInputCursor(end === -1 ? input.length : end);
      return;
    }

    if (key.ctrl && char === 'u') {
      setPromptValue('');
      return;
    }

    if (key.backspace) {
      if (inputCursor > 0) {
        const start = previousGrapheme(input, inputCursor);
        setPromptValue(input.slice(0, start) + input.slice(inputCursor), start);
      }
      return;
    }

    if (key.delete) {
      if (inputCursor < input.length) {
        const nextValue = input.slice(0, inputCursor) + input.slice(nextGrapheme(input, inputCursor));
        setPromptValue(nextValue, inputCursor);
      }
      return;
    }

    if (char && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.ctrl && !key.meta) {
      insertPromptText(normalizePaste(char));
    }
  };

  usePaste(text => {
    if (isTrusted && !confirmPrompt && !themePicker) insertPromptText(normalizePaste(text));
  });

  useInput((char, key) => {
    if (char.length > 1 && /[\r\n]/.test(char)) {
      if (isTrusted && !confirmPrompt && !themePicker) insertPromptText(normalizePaste(char));
      return;
    }
    handleCharInput(char, key);
  });

  if (themePicker === 'startup') {
    return <ThemePicker firstRun selected={themeOptions[themeIndex].name} width={layoutWidth} rows={rows} error={themeError} />;
  }

  if (!isTrusted) {
    return <TrustGate trustCursor={trustCursor} width={layoutWidth} short={short} />;
  }

  const activeIndex = isStreaming ? history.findIndex(message => message.id === activeAssistantId.current) : -1;
  const committed = activeIndex < 0 ? history : history.slice(0, activeIndex);
  const active = activeIndex < 0 ? [] : history.slice(activeIndex);

  return (
    <Box flexDirection="column" width={layoutWidth}>
      <Static items={[welcomeBlock, ...committed]}>
        {(h) => h.role === 'welcome' ? (
          <VertexHeader key={h.id} width={layoutWidth} short={short} model={process.env.AI_MODEL} cwd={process.cwd()} avatar={showPet} />
        ) : (
          <Box key={h.id} marginY={1} flexDirection="column">
            <Text color={h.role === 'user' ? colors.accent : colors.text}>
               {h.role === 'user' ? '> ' : ''}{h.content}
            </Text>
          </Box>
        )}
      </Static>
      {active.map(message => (
        <ActiveStreamView key={message.id} content={message.content} role={message.role} />
      ))}

      {taskStage !== 'idle' && (
        <AgentStatusMonitor
          status={taskStage}
          message={isStreaming
            ? `${taskLabel}${queuedQueries.length > 0 ? ` · ${queuedQueries.length} queued` : ''} · Esc to cancel`
            : taskLabel}
        />
      )}

      {!isStreaming && taskStage !== 'idle' && taskStartedAt > 0 && (
        <TaskResultSummary
          status={taskStage}
          durationMs={taskDurationMs}
          output={history.filter((item) => item.role === 'assistant').slice(-1)[0]?.content ?? ''}
        />
      )}

      {confirmPrompt && (
        <PermissionPrompt
          key={confirmPrompt.id}
          command={confirmPrompt.message}
          onResolve={approved => {
            confirmPrompt.resolve(approved);
            setHistory(previous => [
              ...previous,
              {
                id: `prompt-result-${confirmPrompt.id}`,
                role: 'assistant',
                content: `${approved ? '✔' : '✖'} Action ${approved ? 'Approved' : 'Rejected'}: ${formatApprovalAction(confirmPrompt.message)}`
              }
            ]);
            setConfirmPrompt(current => current?.id === confirmPrompt.id ? null : current);
          }}
        />
      )}

      {!themePicker && !confirmPrompt && showPet && (
        <VertexPet working={isStreaming} interaction={petInteraction} celebrate={taskStage === 'completed'} />
      )}

      {themePicker === 'command' && !confirmPrompt && (
        <ThemePicker firstRun={false} selected={themeOptions[themeIndex].name} width={layoutWidth} rows={rows} error={themeError} />
      )}

      {!themePicker && !confirmPrompt && (
        <PromptBar 
          cursor={inputCursor} 
          input={input} 
          isStreaming={isStreaming} 
          selectedSuggestionIndex={selectedSuggestionIndex} 
          queuedQueries={queuedQueries}
          width={layoutWidth}
          height={rows}
        />
      )}
      <TerminalStatus
        width={layoutWidth}
        short={short}
        approval={Boolean(confirmPrompt)}
        running={isStreaming}
        mode={getAutonomyMode()}
        model={process.env.AI_MODEL}
      />
    </Box>
  );
};

export default App;

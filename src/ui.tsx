import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout, Static } from 'ink';
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
import { VertexHeader, AgentStatusMonitor, PermissionPrompt, TaskResultSummary, getTerminalLayoutWidth, type TaskLifecycleStatus } from './components.js';
import { listWorkspaceSkills, readWorkspaceSkill } from './core/skills/SkillLoader.js';
import { forceSafeMode, getAutonomyMode } from './core/policy/ModeControl.js';

type HistoryMessage = { id: string; role: 'user' | 'assistant'; content: string };
type ConfirmPrompt = { message: string; resolve: (value: boolean) => void };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function TrustGate({ trustCursor, width }: { trustCursor: number; width: number }) {
  return (
    <Box flexDirection="column" width={width} padding={1} borderStyle="round" borderColor="dim">
      <Text color="cyan" bold>VERTEX ISOLATION WARNING</Text>
      <Box marginY={1}>
        <Text dimColor>
          Vertex requires explicit trust to operate in this directory.
          If granted, Vertex will have read/write access to this folder and subdirectories.
        </Text>
      </Box>
      <Box flexDirection="column">
        <Text color={trustCursor === 1 ? 'cyan' : 'dim'}>
          {trustCursor === 1 ? '> ' : '  '}1. Trust this workspace (Enable full access)
        </Text>
        <Text color={trustCursor === 2 ? 'cyan' : 'dim'}>
          {trustCursor === 2 ? '> ' : '  '}2. Exit
        </Text>
      </Box>
    </Box>
  );
}

const COMMANDS = [
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

function ActiveStreamView({ content, role }: { content: string; role: 'user' | 'assistant' }) {
  const MAX_STREAM_LINES = 15;
  const lines = content.split('\n');
  const isTruncated = lines.length > MAX_STREAM_LINES;
  const visibleLines = isTruncated ? lines.slice(-MAX_STREAM_LINES) : lines;
  const displayContent = visibleLines.join('\n');

  return (
    <Box marginY={1} flexDirection="column">
      {isTruncated && (
        <Text color="gray" italic>
          [... {lines.length - MAX_STREAM_LINES} lines active stream ... ]
        </Text>
      )}
      <Text color={role === 'user' ? 'cyan' : 'white'} dimColor={role === 'assistant'}>
        {role === 'user' ? '> ' : ''}{displayContent}
      </Text>
    </Box>
  );
}

function PromptBar({ input, cursor, isStreaming, selectedSuggestionIndex, queuedQueries, width }: { input: string, cursor: number, isStreaming: boolean, selectedSuggestionIndex: number, queuedQueries: string[], width: number }) {
  const beforeCursor = input.slice(0, cursor);
  const cursorChar = input[cursor] || ' ';
  const afterCursor = input.slice(cursor + 1);

  const showSuggestions = input.startsWith('/') && !input.includes(' ');
  const filteredCommands = showSuggestions 
    ? COMMANDS.filter(cmd => cmd.name.startsWith(input.toLowerCase()))
    : [];

  return (
    <Box flexDirection="column" width={width}>
      {/* Input Prompt Area */}
      <Box marginTop={1} paddingX={0}>
        <Text bold color={isStreaming ? "yellow" : "white"}>{'> '} </Text>
        {input.length > 0 ? (
          <Box>
            <Text>
              <Text>{beforeCursor}</Text>
              <Text backgroundColor="cyan" color="black">{cursorChar}</Text>
              <Text>{afterCursor}</Text>
            </Text>
          </Box>
        ) : (
          <Box>
            <Text backgroundColor="cyan" color="black"> </Text>
          </Box>
        )}
      </Box>

      {/* Queued queries badge */}
      {queuedQueries.length > 0 && (
        <Box marginTop={0} flexDirection="column">
          <Text color="yellow" bold>
            [Queued in waiting ({queuedQueries.length})]:
          </Text>
          {queuedQueries.map((q, idx) => (
            <Text key={`queued-${idx}-${q.slice(0, 10)}`} color="dim">
              {"  "}{idx + 1}. {q.length > 110 ? `${q.slice(0, 107)}…` : q}
            </Text>
          ))}
        </Box>
      )}

      {/* Bottom Divider */}
      <Box marginTop={0}>
        <Text color="gray">{"─".repeat(Math.max(1, width - 1))}</Text>
      </Box>

      {/* Dynamic Suggestions or Help */}
      <Box marginTop={0} flexDirection="column">
        {showSuggestions ? (
          <Box flexDirection="column">
            <Text color="gray">COMMAND PALETTE · {filteredCommands.length} match{filteredCommands.length === 1 ? '' : 'es'} · Tab/↑/↓ to select</Text>
            {filteredCommands.length > 0 ? (
              filteredCommands.map((cmd, idx) => (
                <Box key={cmd.name} flexDirection="row">
                  <Box width={20}>
                    <Text color={idx === selectedSuggestionIndex ? 'green' : 'cyan'} bold={idx === selectedSuggestionIndex}>
                      {idx === selectedSuggestionIndex ? '› ' : '  '}{cmd.name}
                    </Text>
                  </Box>
                  <Box flexGrow={1}>
                    <Text color={idx === selectedSuggestionIndex ? 'white' : 'gray'}>{cmd.desc}</Text>
                  </Box>
                </Box>
              ))
            ) : (
              <Text color="yellow">No command matches “{input}”. Try /help to see available commands.</Text>
            )}
          </Box>
        ) : input.startsWith('?') ? (
          <Text color="cyan">KEYBOARD · Enter run · Tab/↑/↓ select command · ↑/↓ history · ←/→ edit · Ctrl+A/E start/end · Ctrl+U clear · Esc cancel/clear · Ctrl+C exit</Text>
        ) : isStreaming ? (
          <Text color="yellow">RUNNING · Esc cancels current task · Enter queues the next task · {queuedQueries.length} queued</Text>
        ) : (
          <Text color="gray">Enter run · / commands · ? shortcuts · ↑ history · Esc clear input · Ctrl+C exit</Text>
        )}
      </Box>
    </Box>
  );
}

  const App = () => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const layoutWidth = getTerminalLayoutWidth(stdout.columns);
  const [isTrusted, setIsTrusted] = useState(false);
  const [trustCursor, setTrustCursor] = useState(1);
  const [input, setInput] = useState('');
  const [inputCursor, setInputCursor] = useState(0);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [taskStage, setTaskStage] = useState<TaskLifecycleStatus | 'idle'>('idle');
  const [taskLabel, setTaskLabel] = useState('');
  const [taskStartedAt, setTaskStartedAt] = useState(0);
  const [taskDurationMs, setTaskDurationMs] = useState(0);
  const [queuedQueries, setQueuedQueries] = useState<string[]>([]);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);
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
    setQueuedQueries([]);
    setTaskStage('cancelled');
    setTaskLabel('Task cancelled by user');
    setIsStreaming(false);
    updateLastAssistant('[CANCELLED: Task interrupted by user via Esc]');
  };

  const setPromptValue = (value: string, cursor = value.length) => {
    setInput(value);
    setInputCursor(clamp(cursor, 0, value.length));
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
  };

  const updateLastAssistant = (content: string) => {
    setHistory((previous) => {
      const updated = [...previous];
      if (updated.length > 0) {
        const last = updated[updated.length - 1];
        updated[updated.length - 1] = { ...last, content };
      }
      return updated;
    });
  };

  const lastUpdateMs = useRef(0);
  const pendingUpdateTimer = useRef<NodeJS.Timeout | null>(null);

  const updateLastAssistantThrottled = (content: string, force = false) => {
    const now = Date.now();
    if (force || now - lastUpdateMs.current >= 45) {
      if (pendingUpdateTimer.current) {
        clearTimeout(pendingUpdateTimer.current);
        pendingUpdateTimer.current = null;
      }
      lastUpdateMs.current = now;
      updateLastAssistant(content);
    } else if (!pendingUpdateTimer.current) {
      pendingUpdateTimer.current = setTimeout(() => {
        lastUpdateMs.current = Date.now();
        pendingUpdateTimer.current = null;
        updateLastAssistant(content);
      }, 45 - (now - lastUpdateMs.current));
    }
  };

  const makeConfirm = () => (message: string) => {
    if (autoApproveToolsRef.current) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      setConfirmPrompt({
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
    appendTurn(query);
    setPromptValue('');
    setTaskLabel(query.length > 72 ? query.slice(0, 69) + '…' : query);
    setTaskStartedAt(startedAt);
    setTaskDurationMs(0);
    setTaskStage('starting');
    setIsStreaming(true);

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
          updateLastAssistantThrottled(fullText);
        }
      } else {
        const orchestrator = await getOrchestrator();
        const stream = orchestrator.delegateTask(routedPrompt, makeConfirm(), controller.signal);
        for await (const chunk of stream) {
          if (controller.signal.aborted) break;
          fullText += chunk;
          updateLastAssistantThrottled(fullText);
        }
        if (!controller.signal.aborted) {
          orchestrator.recordTurn(query, fullText);
        }
      }
      if (!controller.signal.aborted) setTaskStage('completed');
    } catch (error: any) {
      if (error.name === 'AbortError' || controller.signal.aborted) {
        fullText += '\n[CANCELLED: Task interrupted by user via Esc]';
        setTaskStage('cancelled');
        setTaskLabel('Task cancelled by user');
        updateLastAssistantThrottled(fullText, true);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        fullText = `[VERTEX ERROR] ${message}`;
        setTaskStage('failed');
        setTaskLabel(message.length > 72 ? message.slice(0, 69) + '…' : message);
        updateLastAssistantThrottled(fullText, true);
      }
    } finally {
      if (currentAbortController.current === controller) {
        currentAbortController.current = null;
      }
      updateLastAssistantThrottled(fullText, true);
      setTaskDurationMs(Date.now() - startedAt);
      setIsStreaming(false);
    }
  };

  const runImmediateTask = (query: string, task: () => Promise<string>) => {
    const controller = new AbortController();
    const startedAt = Date.now();
    currentAbortController.current = controller;
    setPromptValue('');
    appendTurn(query);
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
          updateLastAssistant(result);
          orchestratorRef.current?.recordTurn(query, result);
          setTaskStage('completed');
        } else {
          setTaskStage('cancelled');
          setTaskLabel('Task cancelled by user');
        }
      } catch (error: any) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          updateLastAssistant(`[VERTEX ERROR] ${message}`);
          setTaskStage('failed');
          setTaskLabel(message.length > 72 ? message.slice(0, 69) + '…' : message);
        }
      } finally {
        if (currentAbortController.current === controller) {
          currentAbortController.current = null;
        }
        setTaskDurationMs(Date.now() - startedAt);
        setIsStreaming(false);
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
      appendTurn(query, 'Shortcuts:\n? - Show shortcuts\n/ - List commands\nCtrl+C - Exit\nUp/Down Arrow - Navigate history\nLeft/Right Arrow - Move cursor');
      return;
    }

    if (lowerQuery === '/' || lowerQuery === 'help' || lowerQuery === '/help') {
      setPromptValue('');
      appendTurn(query, [
        'VERTEX COMMANDS',
        '',
        ...COMMANDS.map((cmd) => `${cmd.name.padEnd(16)} ${cmd.desc}`),
        '',
        'Tip: type / followed by a few letters to filter commands. Use Tab or ↑/↓ to select, then Enter.',
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
      const nextIndex = historyCursor === null ? promptHistory.length - 1 : Math.max(0, historyCursor - 1);
      setHistoryCursor(nextIndex);
      setPromptValue(promptHistory[nextIndex]);
      return;
    }
    if (historyCursor === null) return;
    const nextIndex = historyCursor + 1;
    if (nextIndex >= promptHistory.length) {
      setHistoryCursor(null);
      setPromptValue('');
      return;
    }
    setHistoryCursor(nextIndex);
    setPromptValue(promptHistory[nextIndex]);
  };

  const handleCharInput = (char: string, key: any) => {
    if (key.ctrl && char === 'c') {
      exit();
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

    const showSuggestions = input.startsWith('/') && !input.includes(' ');
    const filteredCommands = showSuggestions 
      ? COMMANDS.filter(cmd => cmd.name.startsWith(input.toLowerCase()))
      : [];

    if (key.tab && showSuggestions && filteredCommands.length > 0) {
      setSelectedSuggestionIndex((prev) => (prev + 1) % filteredCommands.length);
      return;
    }

    if (char === ' ' && showSuggestions && filteredCommands.length > 0) {
      const completed = filteredCommands[selectedSuggestionIndex]?.name;
      if (completed) {
        setPromptValue(completed + ' ');
        return;
      }
    }

    if (key.return) {
      if (showSuggestions && filteredCommands.length > 0) {
        const completed = filteredCommands[selectedSuggestionIndex]?.name || input;
        if (isStreaming) {
          pushPromptHistory(completed);
          setQueuedQueries((prev) => [...prev, completed]);
          setPromptValue('');
        } else {
          submitPrompt(completed);
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
      setInputCursor((current) => clamp(current - 1, 0, input.length));
      return;
    }

    if (key.rightArrow) {
      setInputCursor((current) => clamp(current + 1, 0, input.length));
      return;
    }

    if (key.ctrl && char === 'a') {
      setInputCursor(0);
      return;
    }

    if (key.ctrl && char === 'e') {
      setInputCursor(input.length);
      return;
    }

    if (key.ctrl && char === 'u') {
      setPromptValue('');
      return;
    }

    if (key.backspace) {
      if (inputCursor > 0) {
        const nextValue = input.slice(0, inputCursor - 1) + input.slice(inputCursor);
        setPromptValue(nextValue, inputCursor - 1);
      }
      return;
    }

    if (key.delete) {
      if (inputCursor < input.length) {
        const nextValue = input.slice(0, inputCursor) + input.slice(inputCursor + 1);
        setPromptValue(nextValue, inputCursor);
      }
      return;
    }

    if (char && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.ctrl && !key.meta) {
      const nextValue = input.slice(0, inputCursor) + char + input.slice(inputCursor);
      setPromptValue(nextValue, inputCursor + char.length);
    }
  };

  useInput((char, key) => {
    // Intercept multi-line pastes, but ignore single Enter keystrokes (\r or \n)
    if (char && char.length > 1 && (char.includes('\r') || char.includes('\n'))) {
      const parts = char.split(/\r\n|\r|\n/);
      let tempTrusted = isTrusted;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;

        if (!tempTrusted) {
          if (part === '1') {
            process.env.VERTEX_WORKSPACE_ROOT = process.cwd();
            setIsTrusted(true);
            tempTrusted = true;
          } else if (part === '2') {
            exit();
          }
        } else {
          submitPrompt(part);
        }
      }
      return;
    }

    handleCharInput(char, key);
  });

  if (!isTrusted) {
    return <TrustGate trustCursor={trustCursor} width={layoutWidth} />;
  }

  return (
    <Box flexDirection="column" width={layoutWidth}>
      <VertexHeader />
      {history.length === 0 && !isStreaming && (
        <Box flexDirection="column" width={layoutWidth} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} marginY={1}>
          <Text color="cyan" bold>Welcome to VERTEX</Text>
          <Text color="white">Your model-agnostic coding and security workspace.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">Try a task:</Text>
            <Text color="green">› “Explain this repository and identify its main risks.”</Text>
            <Text color="green">› “Find a bug, add a regression test, and run the tests.”</Text>
            <Text color="green">› “/health”  ·  “/scope”  ·  “/help”</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">Tip: use / to discover commands, ? for shortcuts, and Esc to cancel a running task.</Text>
          </Box>
        </Box>
      )}
      <Static items={isStreaming ? history.slice(0, -1) : history}>
        {(h) => (
          <Box key={h.id} marginY={1} flexDirection="column">
            <Text color={h.role === 'user' ? 'cyan' : 'white'} dimColor={h.role === 'assistant'}>
               {h.role === 'user' ? '> ' : ''}{h.content}
            </Text>
          </Box>
        )}
      </Static>
      {isStreaming && history.length > 0 && (
        <ActiveStreamView 
          content={history[history.length - 1].content} 
          role={history[history.length - 1].role} 
        />
      )}

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
            command={confirmPrompt.message} 
            onResolve={(approved) => {
                confirmPrompt.resolve(approved);
                setHistory((prev) => [
                  ...prev,
                  { 
                    id: `prompt-result-${Date.now()}`, 
                    role: 'assistant', 
                    content: `${approved ? '✔' : '✖'} Action ${approved ? 'Approved' : 'Rejected'}: ${confirmPrompt.message}` 
                  }
                ]);
                setConfirmPrompt(null);
            }} 
        />
      )}

      {!confirmPrompt && (
        <PromptBar 
          cursor={inputCursor} 
          input={input} 
          isStreaming={isStreaming} 
          selectedSuggestionIndex={selectedSuggestionIndex} 
          queuedQueries={queuedQueries}
          width={layoutWidth}
        />
      )}
    </Box>
  );
};

export default App;

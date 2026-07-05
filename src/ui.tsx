import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, Static } from 'ink';
import path from 'path';
import os from 'os';
import { AgentManager } from './core/agent/AgentManager.js';
import { NcbiFetchTool, UniProtFetchTool, PubChemSearchTool, PubMedSearchTool, ArxivSearchTool } from './tools/ScienceSkills.js';
import { collectHealthStatus, formatHealthReport } from './core/health.js';
import { describeScope, ensureScopeFile } from './core/policy/PolicyEngine.js';
import { SafetyResearchSandboxTool } from './tools/DockerSandbox.js';
import { BrowserAgent } from './agents/BrowserAgent.js';
import { VertexHeader, AgentStatusMonitor, PermissionPrompt } from './components.js';

ensureScopeFile();

type HistoryMessage = { id: string; role: 'user' | 'assistant'; content: string };
type ConfirmPrompt = { message: string; resolve: (value: boolean) => void };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function TrustGate({ trustCursor }: { trustCursor: number }) {
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="dim">
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
  { name: '/clear', desc: 'Clear history' },
  { name: '/health', desc: 'System status report' },
  { name: '/scope', desc: 'View current policy boundaries' },
  { name: '/exit', desc: 'Quit session' },
  { name: '/sandbox', desc: 'Run command in isolated Docker' },
  { name: '/safe-sandbox', desc: 'Run safety research command in Docker' },
  { name: '/audit', desc: 'Run security audit on path' },
  { name: '/nyx', desc: 'Offensive operations with NyxAgent' },
  { name: '/search', desc: 'Search the web using DuckDuckGo' },
  { name: '/open', desc: 'Browse target URL' },
  { name: '/goal', desc: 'Run autonomously until goal is achieved' },
  { name: '/schedule', desc: 'Schedule a recurring command execution' },
  { name: '/grill-me', desc: 'Interactive requirements interview' },
  { name: '/learn', desc: 'Extract and save learned rules' },
  { name: '/skill', desc: 'Query databases (ncbi, uniprot, pubchem, pubmed, arxiv)' },
  { name: '/gpu', desc: 'Provision, status, logs, ssh, or destroy GPU jobs' }
];

function PromptBar({ input, cursor, isStreaming, selectedSuggestionIndex }: { input: string, cursor: number, isStreaming: boolean, selectedSuggestionIndex: number }) {
  const beforeCursor = input.slice(0, cursor);
  const cursorChar = input[cursor] || ' ';
  const afterCursor = input.slice(cursor + 1);

  const showSuggestions = input.startsWith('/') && !input.includes(' ');
  const filteredCommands = showSuggestions 
    ? COMMANDS.filter(cmd => cmd.name.startsWith(input.toLowerCase()))
    : [];

  return (
    <Box flexDirection="column" width={97}>
      {/* Input Prompt Area */}
      <Box marginTop={1} paddingX={0}>
        <Text bold>{'> '} </Text>
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

      {/* Bottom Divider */}
      <Box marginTop={0}>
        <Text color="gray">{"─".repeat(97)}</Text>
      </Box>

      {/* Dynamic Suggestions or Help */}
      <Box marginTop={0} flexDirection="column">
        {showSuggestions ? (
          filteredCommands.length > 0 ? (
            filteredCommands.map((cmd, idx) => (
              <Box key={cmd.name} flexDirection="row">
                <Box width={18}>
                  <Text color={idx === selectedSuggestionIndex ? 'green' : 'cyan'} bold={idx === selectedSuggestionIndex}>
                    {idx === selectedSuggestionIndex ? '> ' : '  '}{cmd.name}
                  </Text>
                </Box>
                <Box flexGrow={1}>
                  <Text color={idx === selectedSuggestionIndex ? 'white' : 'gray'}>{cmd.desc}</Text>
                </Box>
              </Box>
            ))
          ) : (
            <Text color="red">No matching commands found.</Text>
          )
        ) : input.startsWith('?') ? (
          <Text color="cyan">Shortcuts: ? (shortcuts) | / (commands) | Ctrl+C (exit) | Up/Down (history)</Text>
        ) : (
          <Text color="gray">? for shortcuts</Text>
        )}
      </Box>
    </Box>
  );
}

const App = () => {
  const { exit } = useApp();
  const [isTrusted, setIsTrusted] = useState(false);
  const [trustCursor, setTrustCursor] = useState(1);
  const [input, setInput] = useState('');
  const [inputCursor, setInputCursor] = useState(0);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);
  const [autoApproveTools] = useState(false);

  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);

  const orchestrator = useRef(new AgentManager()).current;
  const autoApproveToolsRef = useRef(false);

  useEffect(() => {
    autoApproveToolsRef.current = autoApproveTools;
  }, [autoApproveTools]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [input]);

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
    appendTurn(query);
    setPromptValue('');
    setIsStreaming(true);

    let fullText = '';
    try {
      let useDaemon = false;
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 600);
        const statusCheck = await fetch('http://127.0.0.1:8899/status', { signal: controller.signal });
        clearTimeout(id);
        if (statusCheck.ok) {
          const json = await statusCheck.json();
          if (json && json.status === 'running') {
            useDaemon = true;
          }
        }
      } catch {
        // Silent fallback
      }

      if (useDaemon) {
        const response = await fetch('http://127.0.0.1:8899/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: routedPrompt, autoApprove: false })
        });
        if (!response.ok) {
          throw new Error(`Daemon execution failed with status ${response.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Daemon stream returned empty body.');
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          updateLastAssistant(fullText);
        }
      } else {
        const stream = orchestrator.delegateTask(routedPrompt, makeConfirm());
        for await (const chunk of stream) {
          fullText += chunk;
          updateLastAssistant(fullText);
        }
        orchestrator.recordTurn(query, fullText);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fullText = `[VERTEX ERROR] ${message}`;
      updateLastAssistant(fullText);
    } finally {
      setIsStreaming(false);
    }
  };

  const runImmediateTask = (query: string, task: () => Promise<string>) => {
    setPromptValue('');
    appendTurn(query);
    setIsStreaming(true);
    void (async () => {
      try {
        const result = await task();
        updateLastAssistant(result);
        orchestrator.recordTurn(query, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateLastAssistant(`[VERTEX ERROR] ${message}`);
      } finally {
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
        orchestrator.clearHistory();
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

    if (lowerQuery === '?' || lowerQuery === '/?') {
      setPromptValue('');
      appendTurn(query, 'Shortcuts:\n? - Show shortcuts\n/ - List commands\nCtrl+C - Exit\nUp/Down Arrow - Navigate history\nLeft/Right Arrow - Move cursor');
      return;
    }

    if (lowerQuery === '/' || lowerQuery === 'help' || lowerQuery === '/help') {
      setPromptValue('');
      appendTurn(query, 'Arrektys Code Commands:\n/clear - Clear history\n/health - System status\n/scope - View policy\n/exit - Quit\n/sandbox <cmd> - Run isolated\n/safe-sandbox <cmd> - Safety research\n/audit [path] - Run security audit\n/nyx <prompt> - Offensive ops\n/search <query> - Web search\n/open <url> - Browse URL\n/gpu deploy <script> [--gpu <model>] [--provider <name>] - Deploy GPU job\n/gpu status [id] - Check GPU job status\n/gpu list [provider] - List available GPUs\n/gpu logs <id> - Stream GPU logs\n/gpu destroy <id> - Terminate GPU instance\n/gpu ssh <id> <command> - Remote execute on GPU\n/goal <objective> - Run autonomously until achieved\n/schedule <seconds> <cmd> - Schedule a command\n/grill-me - Interactive requirement interview\n/learn - Extract and save learned rules\n/skill <name> <query> - Query database (ncbi, uniprot, pubchem, pubmed, arxiv)');
      return;
    }

    if (lowerQuery === '/clear' || lowerQuery === 'clear') {
      setPromptValue('');
      setHistory([]);
      orchestrator.clearHistory();
      process.stdout.write('\x1Bc');
      return;
    }

    if (lowerQuery === 'exit' || lowerQuery === 'quit' || lowerQuery === '/exit' || lowerQuery === '/quit') {
      exit();
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

  useInput((char, key) => {
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

    if (key.return && !isStreaming) {
      if (showSuggestions && filteredCommands.length > 0) {
        const completed = filteredCommands[selectedSuggestionIndex]?.name || input;
        submitPrompt(completed);
        return;
      }
      if (input.trim().length > 0) {
        submitPrompt(input);
      }
      return;
    }

    if (isStreaming) {
      return;
    }

    if (key.escape) {
      setPromptValue('');
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

    if (!isStreaming && char && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.ctrl && !key.meta) {
      const nextValue = input.slice(0, inputCursor) + char + input.slice(inputCursor);
      setPromptValue(nextValue, inputCursor + char.length);
    }
  });

  if (!isTrusted) {
    return <TrustGate trustCursor={trustCursor} />;
  }

  return (
    <Box flexDirection="column" width="100%">
      <VertexHeader />
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
          <Box marginY={1} flexDirection="column">
            <Text color={history[history.length - 1].role === 'user' ? 'cyan' : 'white'} dimColor={history[history.length - 1].role === 'assistant'}>
               {history[history.length - 1].role === 'user' ? '> ' : ''}{history[history.length - 1].content}
            </Text>
          </Box>
      )}

      {isStreaming && <AgentStatusMonitor message="Agent is thinking..." />}

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
        />
      )}
    </Box>
  );
};

export default App;

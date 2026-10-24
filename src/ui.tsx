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
import { VertexHeader, VertexSidebar, AgentStatusMonitor, PermissionPrompt, TaskResultSummary, getTerminalLayoutWidth, type TaskLifecycleStatus } from './components.js';
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
          {trustCursor 
…[1 chars truncated — re-run with head/grep/tail for full output]…
edStream(query, 'Start an interactive interview with me to align on our plan. Ask me up to 3 clarifying questions one-by-one to probe for requirements, constraints, and architecture.');
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
    <Box flexDirection="row" width={layoutWidth}>
      {showSidebars && <VertexSidebar side="left" width={18} isStreaming={isStreaming} taskLabel={taskLabel} />}
      <Box flexDirection="column" width={centerWidth}>
      <VertexHeader width={centerWidth} />
      {history.length === 0 && !isStreaming && (
        <Box flexDirection="column" width={centerWidth} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} marginY={1}>
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
          width={centerWidth}
        />
      )}
      </Box>
      {showSidebars && <VertexSidebar side="right" width={22} isStreaming={isStreaming} taskLabel={taskLabel} />}
    </Box>
  );
};

export default App;

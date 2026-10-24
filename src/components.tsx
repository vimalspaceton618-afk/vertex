import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { APP_VERSION_LABEL } from './version.js';

export function getTerminalLayoutWidth(columns: number | undefined): number {
  const measuredColumns = Number.isFinite(columns) && typeof columns === 'number' && columns > 0 ? columns : 80;
  return Math.max(40, Math.min(120, measuredColumns));
}

const RobotLogo = () => (
  <Box flexDirection="column" alignItems="center" marginY={1}>
    <Text color="cyan" bold>██╗   ██╗</Text>
    <Text color="blue" bold>╚██╗ ██╔╝</Text>
    <Text color="magenta" bold> ╚████╔╝ </Text>
    <Text color="cyan" bold>  ╚══╝   </Text>
  </Box>
);

export const VertexHeader: React.FC<{ version?: string; activeAgent?: string; width?: number }> = ({
  version = APP_VERSION_LABEL,
  activeAgent = 'VERTEX',
  width
}) => {
  const { stdout } = useStdout();
  const terminalWidth = Math.max(40, Math.min(120, width ?? getTerminalLayoutWidth(stdout.columns)));
  const compact = terminalWidth < 72;
  const activeModel = process.env.AI_MODEL || 'provider not configured';
  const currentCwd = process.cwd();
  const cwdDisplay = currentCwd.length > terminalWidth - 12 ? `…${currentCwd.slice(-(terminalWidth - 13))}` : currentCwd;
  const title = `${activeAgent} · ${version}`;
  const rule = '─'.repeat(Math.max(0, terminalWidth - title.length - 6));

  return (
    <Box flexDirection="column" width={terminalWidth}>
      <Box flexDirection="row" flexWrap="nowrap">
        <Text color="cyan" bold>╭─ {title} </Text>
        <Text color="blue">{rule}╮</Text>
      </Box>
      {compact ? (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={terminalWidth}>
          <Text color="white" bold>Welcome to VERTEX</Text>
          <Text color="gray">{activeModel}</Text>
          <Text color="gray">{cwdDisplay}</Text>
          <Text color="cyan">Use /help · ? for shortcuts</Text>
        </Box>
      ) : (
        <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={2} paddingY={1} width={terminalWidth}>
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="column">
              <Text color="cyan" bold>██╗   ██╗███████╗██████╗ ████████╗███████╗██╗  ██╗</Text>
              <Text color="blue" bold>╚██╗ ██╔╝██╔════╝██╔══██╗╚══██╔══╝╚══███╔╝╚██╗██╔╝</Text>
              <Text color="magenta" bold> ╚████╔╝ █████╗  ██████╔╝   ██║     ███╔╝  ╚███╔╝</Text>
              <Text color="cyan" bold>  ╚██╔╝  ██╔══╝  ██╔══██╗   ██║    ███╔╝   ██╔██╗</Text>
              <Text color="blue" bold>   ██║   ███████╗██║  ██║   ██║   ███████╗██╔╝ ██╗</Text>
              <Text color="gray">AUTONOMOUS · SECURE · EXTENSIBLE</Text>
            </Box>
            <Box flexDirection="column" alignItems="flex-end">
              <Text color="green" bold>● SESSION READY</Text>
              <Text color="gray">{version}</Text>
              <Text color="gray">{cwdDisplay}</Text>
              <Text color="cyan">{activeModel}</Text>
            </Box>
          </Box>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
            <Text color="yellow" bold>Welcome to VERTEX</Text>
            <Text color="white">Your autonomous AI engineering partner for coding, research and automation.</Text>
            <Text color="gray">Type /help to discover commands · Esc cancels a running task</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export const VertexSidebar: React.FC<{ side: 'left' | 'right'; width: number; isStreaming: boolean; taskLabel: string }> = ({ side, width, isStreaming, taskLabel }) => {
  const narrow = width < 17;
  const panelWidth = Math.max(12, width);
  const activeModel = process.env.AI_MODEL || 'auto';
  const cwd = process.cwd();
  const cwdLabel = cwd.length > panelWidth - 5 ? `…${cwd.slice(-(panelWidth - 6))}` : cwd;
  const items = side === 'left'
    ? [['◆', 'Chat'], ['◇', 'Agents'], ['⌘', 'Tools'], ['▣', 'Workspace'], ['◈', 'MCP'], ['⊕', 'Plugins'], ['▤', 'Tasks'], ['⬡', 'Memory'], ['⚙', 'Settings']]
    : [['●', 'Filesystem'], ['●', 'Shell'], ['●', 'Git'], ['●', 'Browser'], ['●', 'Docker'], ['●', 'Search'], ['●', 'Web'], ['●', 'PDF / OCR']];

  return (
    <Box flexDirection="column" width={panelWidth} borderStyle="round" borderColor="blue" paddingX={1}>
      <Text color="cyan" bold>{side === 'left' ? 'VERTEX' : 'LIVE STATUS'}</Text>
      <Text color="gray">{'─'.repeat(Math.max(4, panelWidth - 4))}</Text>
      {side === 'left' ? (
        <>
          {items.map(([icon, label], index) => (
            <Text key={label} color={index === 0 ? 'cyan' : 'white'} bold={index === 0}>{icon} {label}</Text>
          ))}
          <Box marginTop={1} flexDirection="column">
            <Text color="green" bold>● Online</Text>
            <Text color="gray">Model: {activeModel}</Text>
            <Text color="gray">{cwdLabel}</Text>
          </Box>
        </>
      ) : (
        <>
          <Text color="cyan" bold>AGENTS</Text>
          <Text color={isStreaming ? 'yellow' : 'green'}>{isStreaming ? '● Working' : '● Ready'}</Text>
          <Text color="gray">Code / Research</Text>
          <Text color="gray">Security / Data</Text>
          <Text color="cyan" bold>TOOLS</Text>
          {items.map(([icon, label]) => <Text key={label} color="white">{icon} {label}</Text>)}
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow" bold>SYSTEM</Text>
            <Text color="gray">Git: available</Text>
            <Text color="gray">Node: {process.version}</Text>
            <Text color="gray">Activity appears as tasks run.</Text>
          </Box>
          {isStreaming && <Box marginTop={1} flexDirection="column"><Text color="yellow" bold>RUNNING TASK</Text><Text color="gray">{taskLabel.slice(0, Math.max(6, panelWidth - 4))}</Text></Box>}
          {!narrow && <Text color="gray">/help · ? keys</Text>}
        </>
      )}
    </Box>
  );
};

export type TaskLifecycleStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';

export const AgentStatusMonitor: React.FC<{ message: string; status?: TaskLifecycleStatus }> = ({
  message,
  status = 'running'
}) => {
  const active = status === 'starting' || status === 'running';
  const color = status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'cancelled' ? 'yellow' : 'cyan';
  const label = status === 'starting' ? 'STARTING' : status === 'running' ? 'RUNNING' : status === 'completed' ? 'COMPLETED' : status === 'failed' ? 'FAILED' : 'CANCELLED';

  return (
    <Box marginY={1} paddingX={1} flexDirection="column">
      <Box>
        {active ? <Text color={color}><Spinner type="dots" /> </Text> : <Text color={color} bold>{status === 'completed' ? '✓ ' : status === 'failed' ? '✗ ' : '■ '}</Text>}
        <Text color={color} bold>{label}</Text>
        <Text color={active ? color : 'gray'}> · {message}</Text>
      </Box>
    </Box>
  );
};


export interface TaskResultSummaryProps {
  status: TaskLifecycleStatus;
  durationMs: number;
  output: string;
}

export const TaskResultSummary: React.FC<TaskResultSummaryProps> = ({ status, durationMs, output }) => {
  const diffFiles = Array.from(output.matchAll(/^\+\+\+ b\/(.+)$/gm), (match) => match[1]);
  const mentionedFiles = Array.from(output.matchAll(/(?:modified|created|deleted|changed)\s+(?:file\s+)?[:"]?([\w./@-]+\.[\w-]+)/gi), (match) => match[1]);
  const files = Array.from(new Set([...diffFiles, ...mentionedFiles])).slice(0, 6);
  const testLine = output.match(/(?:# tests\s+\d+[\s\S]{0,160}# pass\s+\d+[\s\S]{0,80}# fail\s+0|(?:tests?|suites?)\s+passed\s*[:=]?\s*\d+|(?:all\s+)?\d+\s+tests?\s+passed|(?:tests?|suites?)\s+failed\s*[:=]?\s*\d+|\d+\s+failed(?:,|\s+and\s+)\s*\d+\s+passed)/i);
  const duration = durationMs < 1000 ? String(durationMs) + ' ms' : (durationMs / 1000).toFixed(1) + ' s';
  const statusColor = status === 'completed' ? 'green' : status === 'failed' ? 'red' : 'yellow';

  return (
    <Box borderStyle="round" borderColor={statusColor} paddingX={1} paddingY={1} flexDirection="column" marginY={1}>
      <Box justifyContent="space-between">
        <Text bold color={statusColor}>TASK SUMMARY · {status.toUpperCase()}</Text>
        <Text dimColor>{duration}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="cyan" bold>Changed files (detected)</Text>
        {files.length > 0
          ? files.map((file) => <Text key={file} dimColor>• {file}</Text>)
          : <Text dimColor>No changed-file evidence detected in the response.</Text>}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="cyan" bold>Test evidence (detected)</Text>
        {testLine
          ? <Text dimColor>{testLine[0]}</Text>
          : <Text color="yellow">No explicit test result detected. Verification is unconfirmed.</Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Output: {output.length.toLocaleString()} characters · Based on returned text, not independent repository inspection.</Text>
      </Box>
    </Box>
  );
};

export interface ToolExecutionCardProps {
  toolName: string;
  command: string;
  status: 'running' | 'success' | 'error';
}

export const ToolExecutionCard: React.FC<ToolExecutionCardProps> = ({
  toolName,
  command,
  status
}) => {
  return (
    <Box
      borderStyle="single"
      borderColor="dim"
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Text color="cyan" bold>{toolName}</Text>
        {status === 'running' && <Text color="yellow"><Spinner type="dots" /> Running</Text>}
        {status === 'success' && <Text color="green">✔ Passed</Text>}
        {status === 'error' && <Text color="red">✖ Failed</Text>}
      </Box>
      <Box paddingLeft={2} marginTop={1}>
        <Text dimColor>&gt; {command}</Text>
      </Box>
    </Box>
  );
};

export type Severity = 'CRITICAL' | 'MEDIUM' | 'LOW';

export interface Finding {
  severity: Severity;
  category: string;
  detail: string;
}

export const AuditFindingsTable: React.FC<{ findings: Finding[] }> = ({ findings }) => {
  const getSeverityColor = (sev: Severity) => {
    switch (sev) {
      case 'CRITICAL': return 'red';
      case 'MEDIUM': return 'yellow';
      case 'LOW': return 'cyan';
      default: return 'white';
    }
  };

  if (!findings || findings.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold underline>Security Audit Findings</Text>
      
      {/* Table Header */}
      <Box marginY={1} borderBottom borderColor="dim">
        <Box width="15%"><Text dimColor>SEVERITY</Text></Box>
        <Box width="25%"><Text dimColor>CATEGORY</Text></Box>
        <Box width="60%"><Text dimColor>DETAIL</Text></Box>
      </Box>

      {/* Table Rows */}
      {findings.map((finding, idx) => (
        <Box key={idx} marginBottom={1}>
          <Box width="15%">
            <Text color={getSeverityColor(finding.severity)} bold>
              {finding.severity}
            </Text>
          </Box>
          <Box width="25%">
            <Text>{finding.category}</Text>
          </Box>
          <Box width="60%">
            <Text dimColor>{finding.detail}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
};

export const PermissionPrompt: React.FC<{ command: string; onResolve?: (approved: boolean) => void }> = ({
  command,
  onResolve
}) => {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');

  useInput((input, key) => {
    if (status !== 'pending') return;

    if (input.toLowerCase() === 'y') {
      setStatus('approved');
      onResolve?.(true);
    } else if (input.toLowerCase() === 'n' || key.escape) {
      setStatus('rejected');
      onResolve?.(false);
    }
  });

  if (status === 'approved') {
    return (
      <Box marginY={1}>
        <Text color="green">✔ Action Approved: </Text>
        <Text dimColor>{command}</Text>
      </Box>
    );
  }

  if (status === 'rejected') {
    return (
      <Box marginY={1}>
        <Text color="red">✖ Action Rejected: </Text>
        <Text dimColor>{command}</Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      flexDirection="column"
      marginY={1}
    >
      <Box>
        <Text color="yellow" bold>⚠ VERTEX Agent Request</Text>
      </Box>
      <Box marginTop={1} paddingLeft={2}>
        <Text dimColor>{command}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Allow execution? (</Text>
        <Text color="green" bold>y</Text>
        <Text>/</Text>
        <Text color="red" bold>n</Text>
        <Text>)</Text>
      </Box>
    </Box>
  );
};

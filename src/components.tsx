import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';

const RobotLogo = () => (
  <Box flexDirection="column" alignItems="center" marginY={1}>
    <Text color="cyan"> ▄▄▄▄▄▄▄▄ </Text>
    <Text color="cyan">██▀████▀██</Text>
    <Text color="cyan">██████████</Text>
    <Text color="cyan"> █  ██  █ </Text>
  </Box>
);

export const VertexHeader: React.FC<{ version?: string; activeAgent?: string }> = ({
  version = 'v0.1.6',
  activeAgent = 'Arrektys Code'
}) => {
  const repeatCount = Math.max(0, 91 - activeAgent.length - version.length);
  const activeModel = process.env.AI_MODEL || 'gpt-4o';
  const currentCwd = process.cwd();

  return (
    <Box flexDirection="column" width={97}>
      {/* Top Border with Title */}
      <Box flexDirection="row">
        <Text color="cyan">╭─ </Text>
        <Text color="cyan" bold>{activeAgent} {version} </Text>
        <Text color="cyan">{"─".repeat(repeatCount)}╮</Text>
      </Box>

      {/* Main Content Area */}
      <Box flexDirection="row">
        {/* Left Border */}
        <Box flexDirection="column" width={1}>
          <Text color="cyan">{'│\n│\n│\n│\n│\n│\n│\n│\n│'}</Text>
        </Box>

        {/* Left Pane (Welcome & Details) */}
        <Box width={47} flexDirection="column" alignItems="center" paddingX={2}>
          <Text bold>Welcome back!</Text>
          <RobotLogo />
          <Text color="gray">{activeModel}</Text>
          <Text color="gray">{currentCwd}</Text>
        </Box>

        {/* Center Divider */}
        <Box flexDirection="column" width={1}>
          <Text color="cyan">{'│\n│\n│\n│\n├\n│\n│\n│\n│'}</Text>
        </Box>

        {/* Right Pane (Tips & Activity) */}
        <Box width={47} flexDirection="column" paddingX={2}>
          <Text color="cyan" bold>Tips for getting started</Text>
          <Text>Run /help to see commands for Arrekt...</Text>
          <Text>Note: Launched in home directory.</Text>
          
          <Box flexDirection="row" marginTop={1}>
            <Text color="cyan">{"─".repeat(43)}</Text>
          </Box>
          
          <Text color="cyan" bold>Recent activity</Text>
          <Text color="gray">No recent activity</Text>
        </Box>

        {/* Right Border */}
        <Box flexDirection="column" width={1}>
          <Text color="cyan">{'│\n│\n│\n│\n┤\n│\n│\n│\n│'}</Text>
        </Box>
      </Box>

      {/* Bottom Border */}
      <Box flexDirection="row">
        <Text color="cyan">╰{"─".repeat(47)}┴{"─".repeat(47)}╯</Text>
      </Box>
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
  const testLine = output.match(/(?:\d+\s+passed|tests?\s+passed|all tests? passed|npm test[^\n]*|\d+\s+failed|tests?\s+failed)/i);
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

import React, { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { icons, motion } from './terminal/theme.js';
import { useTerminalColors } from './terminal/ThemeContext.js';
import { WelcomePet } from './terminal/VertexPet.js';
import Spinner from 'ink-spinner';
import { stripVTControlCharacters } from 'node:util';
import { APP_VERSION_LABEL } from './version.js';

export function getTerminalLayoutWidth(columns: number | undefined): number {
  const measuredColumns = Number.isFinite(columns) && typeof columns === 'number' && columns > 0 ? columns : 80;
  return Math.min(120, measuredColumns);
}

function terminalMetadata(value: string): string {
  return stripVTControlCharacters(value).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ');
}

export function VertexHeader({ width, short, model, cwd, avatar }: {
  width: number;
  short: boolean;
  model?: string;
  cwd: string;
  avatar: boolean;
}) {
  const colors = useTerminalColors();
  return (
    <Box width={width} marginBottom={short ? 0 : 1}>
      {avatar && <Box marginRight={2}><WelcomePet /></Box>}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text color={colors.accent} bold wrap="truncate-end">Welcome to VERTEX · {APP_VERSION_LABEL}</Text>
        {width >= 30 && !short && <Text color={colors.muted} wrap="truncate-middle">{terminalMetadata(cwd)}</Text>}
        {width >= 30 && !short && <Text color={colors.muted} wrap="truncate-end">{model ? terminalMetadata(model) : 'Model not configured'}</Text>}
        {width >= 50 && !short && <Text color={colors.muted}>Type /help to discover commands.</Text>}
      </Box>
    </Box>
  );
}

export function TerminalStatus({ width, short, approval, running, mode, model }: {
  width: number;
  short: boolean;
  approval: boolean;
  running: boolean;
  mode: string;
  model?: string;
}) {
  const colors = useTerminalColors();
  const state = approval ? 'Approval required' : running ? 'Esc to interrupt' : mode;
  const extras = approval || running ? [mode] : [];
  if (!short && width >= 50) extras.push(model ? terminalMetadata(model) : 'Model not configured');
  if (!short && !approval && !running && width >= 50) extras.push('? for shortcuts');
  return <Text color={approval ? colors.warning : colors.muted} wrap="truncate-end">{[state, ...extras].join(' · ')}</Text>;
}

export type TaskLifecycleStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';

export const AgentStatusMonitor: React.FC<{ message: string; status?: TaskLifecycleStatus }> = ({
  message,
  status = 'running'
}) => {
  const colors = useTerminalColors();
  const active = status === 'starting' || status === 'running';
  const color = status === 'completed' ? colors.success : status === 'failed' ? colors.error : status === 'cancelled' ? colors.warning : colors.accent;
  const label = status === 'starting' ? 'STARTING' : status === 'running' ? 'RUNNING' : status === 'completed' ? 'COMPLETED' : status === 'failed' ? 'FAILED' : 'CANCELLED';

  return (
    <Box marginY={1} paddingX={1} flexDirection="column">
      <Box>
        {active && motion ? <Text color={color}><Spinner type="dots" /> </Text> : <Text color={color} bold>{(status === 'completed' ? icons.success : status === 'failed' ? icons.error : icons.waiting) + ' '}</Text>}
        <Text color={color} bold>{label}</Text>
        <Text color={active ? color : colors.muted}> · {message}</Text>
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
  const colors = useTerminalColors();
  return (
    <Box
      borderStyle="single"
      borderColor={colors.border}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Text color={colors.accent} bold>{toolName}</Text>
        {status === 'running' && <Text color={colors.warning}>{motion ? <Spinner type="dots" /> : icons.waiting} Running</Text>}
        {status === 'success' && <Text color={colors.success}>✔ Passed</Text>}
        {status === 'error' && <Text color={colors.error}>✖ Failed</Text>}
      </Box>
      <Box paddingLeft={2} marginTop={1}>
        <Text color={colors.muted}>&gt; {command}</Text>
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
  const colors = useTerminalColors();
  const getSeverityColor = (sev: Severity) => {
    switch (sev) {
      case 'CRITICAL': return colors.error;
      case 'MEDIUM': return colors.warning;
      case 'LOW': return colors.accent;
      default: return colors.text;
    }
  };

  if (!findings || findings.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold underline>Security Audit Findings</Text>
      
      {/* Table Header */}
      <Box marginY={1} borderBottom borderColor={colors.border}>
        <Box width="15%"><Text color={colors.muted}>SEVERITY</Text></Box>
        <Box width="25%"><Text color={colors.muted}>CATEGORY</Text></Box>
        <Box width="60%"><Text color={colors.muted}>DETAIL</Text></Box>
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
            <Text color={colors.muted}>{finding.detail}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
};

export function formatApprovalAction(command: string): string {
  return command.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, character =>
    '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

export function PermissionPrompt({ command, onResolve }: {
  command: string;
  onResolve: (approved: boolean) => void;
}) {
  const colors = useTerminalColors();
  const [selection, setSelection] = useState<boolean | null>(null);
  const resolved = useRef(false);

  useInput((input, key) => {
    if (resolved.current || key.eventType === 'repeat' || key.eventType === 'release') return;

    if (key.escape || (key.return && selection !== null)) {
      resolved.current = true;
      onResolve(!key.escape && selection === true);
      return;
    }

    const choice = input.toLowerCase();
    if (choice === 'y' || choice === '1' || key.upArrow) setSelection(true);
    if (choice === 'n' || choice === '2' || key.downArrow) setSelection(false);
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={colors.warning} bold>Permission required</Text>
      <Text>{formatApprovalAction(command)}</Text>
      <Text color={selection === true ? colors.accent : colors.text}>
        {selection === true ? icons.prompt : ' '} 1. Allow once (Y)
      </Text>
      <Text color={selection === false ? colors.accent : colors.text}>
        {selection === false ? icons.prompt : ' '} 2. Deny (N)
      </Text>
      <Text color={colors.muted}>Select, then Enter. Esc denies.</Text>
    </Box>
  );
}

#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { ConfigManager } from './core/config.js';
import { collectDiagnostics, formatDiagnosticReport } from './core/diagnostics.js';
import { initializeWorkspaceConfig } from './core/setup.js';
import { collectHealthStatus, formatHealthReport } from './core/health.js';
import { describeScope, ensureScopeFile } from './core/policy/PolicyEngine.js';
if (process.env.MOCK_TTY === '1' || process.env.MOCK_TTY === 'true') {
  if (process.stdin) {
    process.stdin.isTTY = true;
    (process.stdin as any).setRawMode = () => {};
  }
  if (process.stdout) {
    process.stdout.isTTY = true;
    process.stdout.columns = 100;
    process.stdout.rows = 30;
    if ((process.stdout as any)._handle && typeof (process.stdout as any)._handle.setBlocking === 'function') {
      (process.stdout as any)._handle.setBlocking(true);
    }
  }
}

let commandHandled = false;

const program = new Command();

program
  .name('vertex')
  .description('VERTEX Multi-Agent OS')
  .version('3.0.0')
  .option('--run <prompt>', 'Run in headless mode with a prompt')
  .option('--json', 'Output as JSON in headless mode')
  .option('--yes', 'Auto-approve tool confirmations in headless mode')
  .option('--daemon', 'Start the background daemon server');

program.command('doctor')
  .description('Check the local environment without running agent tasks or printing secrets')
  .option('--json', 'Output structured diagnostics as JSON')
  .action((commandOptions: { json?: boolean }) => {
    commandHandled = true;
    const report = collectDiagnostics();
    // --json is also a root option for headless mode, so Commander may store it on the parent.
    const jsonOutput = Boolean(commandOptions.json || program.opts().json);
    process.stdout.write(jsonOutput
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${formatDiagnosticReport(report)}\n`);
    if (!report.ok) process.exitCode = 1;
  });

program.command('init')
  .description('Create a private .env template in the current workspace without overwriting existing files')
  .action(() => {
    commandHandled = true;
    try {
      const result = initializeWorkspaceConfig(process.cwd());
      process.stdout.write(`${result.message}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[INIT ERROR] ${message}\n`);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);
const options = program.opts();

if (!commandHandled) {
  ConfigManager.init();
  ensureScopeFile();
}

async function runHeadless(prompt: string, asJson: boolean, autoApprove: boolean) {
  process.env.VERTEX_WORKSPACE_ROOT = process.cwd();
  const normalized = prompt.trim().toLowerCase();
  if (normalized === '/health' || normalized === 'health') {
    const status = collectHealthStatus();
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ prompt, health: status }, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatHealthReport(status)}\n`);
    }
    return;
  }
  if (normalized === '/scope' || normalized === '/scope show' || normalized === 'scope') {
    const output = describeScope();
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ prompt, scope: output }, null, 2)}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
    return;
  }
  if (normalized.startsWith('/safe-sandbox ')) {
    const raw = prompt.trim().slice('/safe-sandbox '.length).trim();
    const imageMatch = raw.match(/^--image\s+(\S+)\s+([\s\S]+)$/);
    const image = imageMatch?.[1];
    const command = (imageMatch?.[2] || raw).trim();
    if (!command) {
      const output = 'Usage: /safe-sandbox [--image alpine:latest|python:3.12-alpine|node:22-alpine] <command>';
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
      return;
    }
    const confirm = async () => autoApprove ? true : false;
    const { SafetyResearchSandboxTool } = await import('./tools/DockerSandbox.js');
    const output = await new SafetyResearchSandboxTool().execute({ command, image }, confirm);
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
    return;
  }

  let routedPrompt = prompt;
  if (normalized.startsWith('/sandbox ')) {
    const sandboxCmd = prompt.trim().slice('/sandbox '.length).trim();
    if (!sandboxCmd) {
      const output = 'Usage: /sandbox <shell command>\nExample: /sandbox uname -a';
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
      return;
    }
    routedPrompt = [
      '[ROUTE_DIRECT:CyberAgent]',
      'Use the sandbox_execute tool to run the following command in an isolated Docker container and return the output.',
      `Command: ${sandboxCmd}`
    ].join('\n');
  } else if (normalized.startsWith('/audit')) {
    const auditPath = prompt.trim().slice('/audit'.length).trim() || process.cwd();
    routedPrompt = [
      '[ROUTE_DIRECT:CyberAgent]',
      `Perform a comprehensive security audit on this path: ${auditPath}`,
      'Run the following checks in sequence:',
      '1. Scan for exposed secrets using env_secrets_scan',
      '2. Run file_integrity on the target path',
      '3. Run network_audit to inspect active connections',
      '4. Run process_inspect to list suspicious processes',
      '5. Compile a structured EXECUTIVE SUMMARY with a FINDINGS TABLE and RECOMMENDATIONS.'
    ].join('\n');
  } else if (normalized.startsWith('/nyx ')) {
    const nyxPrompt = prompt.trim().slice('/nyx '.length).trim();
    if (!nyxPrompt) {
      const output = 'Usage: /nyx <offensive security prompt>\nExample: /nyx scan 192.168.1.0/24 with nmap service detection';
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
      return;
    }
    routedPrompt = `[ROUTE_DIRECT:NyxAgent] ${nyxPrompt}`;
  } else if (normalized.startsWith('/phantom ')) {
    const phantomPrompt = prompt.trim().slice('/phantom '.length).trim();
    if (!phantomPrompt) {
      const output = 'Usage: /phantom <red team prompt>\nExample: /phantom run full kill-chain on 192.168.1.50';
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
      return;
    }
    routedPrompt = `[ROUTE_DIRECT:PhantomAgent] ${phantomPrompt}`;
  } else if (normalized.startsWith('/sentinel')) {
    const sentinelPrompt = prompt.trim().slice('/sentinel'.length).trim() || 'run full defensive audit and timeline analysis';
    routedPrompt = `[ROUTE_DIRECT:SentinelAgent] ${sentinelPrompt}`;
  } else if (normalized.startsWith('/recon ')) {
    const reconPrompt = prompt.trim().slice('/recon '.length).trim();
    if (!reconPrompt) {
      const output = 'Usage: /recon <target>\nExample: /recon scan target.com';
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
      return;
    }
    routedPrompt = `[ROUTE_DIRECT:ReconAgent] ${reconPrompt}`;
  } else if (normalized.startsWith('/loot')) {
    const { getLootStore } = await import('./core/LootStore.js');
    const store = getLootStore();
    const arg = prompt.trim().slice('/loot'.length).trim().toLowerCase();
    let output = '';
    if (arg === 'stats') output = store.getStats();
    else if (arg === 'export') output = store.exportJson();
    else if (arg === 'hashcat') output = store.exportHashcat() || 'No hashes in vault.';
    else output = store.query({ target: arg || undefined });

    if (asJson) process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
    else process.stdout.write(`${output}\n`);
    return;
  } else if (normalized.startsWith('/attack-graph')) {
    const { getAttackGraph } = await import('./core/AttackGraph.js');
    const graph = getAttackGraph();
    const output = graph.planNextPhase();
    if (asJson) process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
    else process.stdout.write(`${output}\n`);
    return;
  } else if (normalized.startsWith('/search ')) {
    const searchQuery = prompt.trim().slice('/search '.length).trim();
    if (!searchQuery) {
      const output = 'Usage: /search <query>\nExample: /search kali linux nmap nse scripts';
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
      return;
    }
    const { BrowserAgent } = await import('./agents/BrowserAgent.js');
    const output = await new BrowserAgent().searchDuckDuckGo(searchQuery);
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
    return;
  } else if (normalized.startsWith('/open ')) {
    const url = prompt.trim().slice('/open '.length).trim();
    if (!url) {
      const output = 'Usage: /open <url>';
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
      return;
    }
    const { BrowserAgent } = await import('./agents/BrowserAgent.js');
    const output = await new BrowserAgent().navigateUrl(url);
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
    return;
  } else if (normalized.startsWith('/summarize-url ')) {
    const url = prompt.trim().slice('/summarize-url '.length).trim();
    if (!url) {
      const output = 'Usage: /summarize-url <url>';
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
      return;
    }
    const { BrowserAgent } = await import('./agents/BrowserAgent.js');
    const output = await new BrowserAgent().summarizeUrl(url);
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
    return;
  } else if (normalized.startsWith('/screenshot-url ')) {
    const parts = prompt.trim().slice('/screenshot-url '.length).trim().split(/\s+/);
    const url = parts[0] || '';
    const filePath = parts[1] || `artifacts/screenshots/screenshot-${Date.now()}.png`;
    if (!url) {
      const output = 'Usage: /screenshot-url <url> [filePath]';
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
      return;
    }
    const { BrowserAgent } = await import('./agents/BrowserAgent.js');
    const output = await new BrowserAgent().screenshotUrl(url, filePath);
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
    return;
  }

  const { AgentManager } = await import('./core/agent/AgentManager.js');
  const orchestrator = new AgentManager();
  const confirm = async (msg: string) => autoApprove ? true : false;
  const stream = orchestrator.delegateTask(routedPrompt, confirm);
  let output = '';
  for await (const chunk of stream) {
    output += chunk;
  }
  orchestrator.recordTurn(prompt, output);
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ prompt, output }, null, 2)}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
}

if (options.daemon) {
  import('./core/daemon.js').then(({ startDaemon }) => {
    startDaemon();
  }).catch((error) => {
    process.stderr.write(`[DAEMON START ERROR]: ${error.message}\n`);
    process.exitCode = 1;
  });
} else if (options.run) {
  runHeadless(options.run, Boolean(options.json), Boolean(options.yes)).catch((error) => {
    process.stderr.write(`[HEADLESS ERROR]: ${error.message}\n`);
    process.exitCode = 1;
  });
} else if (commandHandled) {
  // The init/doctor subcommand completed during Commander parsing.
} else {
  import('./ui.js').then(({ default: App }) => {
    const { waitUntilExit } = render(<App />);
    return waitUntilExit();
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[UI START ERROR]: ${message}\\n`);
    process.exitCode = 1;
  });
}

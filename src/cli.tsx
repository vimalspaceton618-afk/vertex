#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import App from './ui.js';
import { ConfigManager } from './core/config.js';
import { AgentManager } from './core/agent/AgentManager.js';
import { collectHealthStatus, formatHealthReport } from './core/health.js';
import { describeScope, ensureScopeFile } from './core/policy/PolicyEngine.js';

ConfigManager.init();
ensureScopeFile();

const program = new Command();

program
  .name('vertex')
  .description('VERTEX Multi-Agent OS')
  .version('3.0.0')
  .option('--run <prompt>', 'Run in headless mode with a prompt')
  .option('--json', 'Output as JSON in headless mode')
  .option('--yes', 'Auto-approve tool confirmations in headless mode');

program.parse(process.argv);
const options = program.opts();

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
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    routedPrompt = [
      '[ROUTE_DIRECT:BrowserAgent]',
      `Use browser_get_content to open this DuckDuckGo search URL: ${url}`,
      `Search query: ${searchQuery}`,
      'Return the most relevant visible results with titles, snippets, and URLs when present.',
      'Keep the answer concise and mention if the browser runtime is not configured.'
    ].join('\n');
  }

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

if (options.run) {
  runHeadless(options.run, Boolean(options.json), Boolean(options.yes)).catch((error) => {
    process.stderr.write(`[HEADLESS ERROR]: ${error.message}\n`);
    process.exitCode = 1;
  });
} else {
  const { waitUntilExit } = render(<App />);
  waitUntilExit().then(() => {
    // Graceful shutdown
  });
}

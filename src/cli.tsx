#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import App from './ui.js';
import { ConfigManager } from './core/config.js';
import { AgentManager } from './core/agent/AgentManager.js';
import { collectHealthStatus, formatHealthReport } from './core/health.js';

ConfigManager.init();

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

  const orchestrator = new AgentManager();
  const confirm = async (msg: string) => autoApprove ? true : false;
  const stream = orchestrator.delegateTask(prompt, confirm);
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

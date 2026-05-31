import { VertexTerminalUI } from './CortexTerminalUI.js';
import chalk from 'chalk';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runExample() {
  const ui = new VertexTerminalUI();

  // Simulate token streaming globally
  const tokenStream = setInterval(() => {
    ui.incrementTokens(Math.floor(Math.random() * 10) + 1);
  }, 100);

  // Step 1: Initializing Agent
  const step1 = 'task-1';
  ui.startTask(step1, 'Initializing Vertex Agent Environment', 'action');
  
  for (let i = 1; i <= 3; i++) {
    await sleep(400);
    ui.updateMeta(step1, `Loading core modules... (${i}/3)`);
  }
  await sleep(300);
  ui.completeTask(step1, 'success');

  // Step 2: Agent Thinking
  const step2 = 'task-2';
  ui.startTask(step2, 'Analyzing user request and forming plan', 'thought');
  ui.updateMeta(step2, 'Parsing context: 1530 tokens read');
  await sleep(1000);
  ui.updateMeta(step2, 'Formulating steps...');
  await sleep(800);
  ui.completeTask(step2, 'success');

  // Step 3: Action Execution with Panel Output
  const step3 = 'task-3';
  ui.startTask(step3, 'Executing file modifications', 'action');
  
  const fileContent = [
    chalk.cyan('function') + ' ' + chalk.green('helloWorld') + '() {',
    '  console.log(' + chalk.yellow("'Hello Vertex!'") + ');',
    '}'
  ].join('\n');

  for (let i = 0; i <= 100; i += 25) {
    ui.updateMeta(step3, `Writing to src/main.ts [${i}%]`);
    await sleep(250);
  }
  
  // Complete with panel
  ui.completeTask(step3, 'success', fileContent);

  // Wrap up
  clearInterval(tokenStream);
  
  // Demonstrate freeze and handoff
  ui.freeze();
  console.log(`\n> ${chalk.dim('User input prompt...')}`);
}

runExample().catch(console.error);

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const ui = fs.readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8');
const cli = fs.readFileSync(new URL('../src/cli.tsx', import.meta.url), 'utf8');
const components = fs.readFileSync(new URL('../src/components.tsx', import.meta.url), 'utf8');
const daemon = fs.readFileSync(new URL('../src/core/daemon.ts', import.meta.url), 'utf8');
const agentManager = fs.readFileSync(new URL('../src/core/agent/AgentManager.ts', import.meta.url), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('command palette includes help and URL workflows implemented by the UI', () => {
  const registry = ui.match(/const COMMANDS = \[([\s\S]*?)\n\];/);
  assert.ok(registry, 'COMMANDS registry exists');
  const commands = [...registry[1].matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]);
  for (const command of ['/help', '/clear', '/health', '/doctor', '/init', '/scope', '/exit', '/search', '/open', '/summarize-url', '/screenshot-url', '/sandbox', '/safe-sandbox', '/audit', '/goal', '/schedule', '/gpu', '/nyx', '/phantom', '/sentinel', '/recon', '/loot', '/attack-graph', '/grill-me', '/learn', '/skill']) {
    assert.ok(commands.includes(command), `palette should include ${command}`);
  }
  assert.equal(new Set(commands).size, commands.length, 'palette command names are unique');
});

test('welcome header adapts to terminal width and has a narrow layout', () => {
  assert.match(components, /useStdout/, 'header should read terminal dimensions');
  assert.match(components, /stdout\.columns/, 'header should use terminal column width');
  assert.match(components, /terminalWidth\s*<\s*72/, 'header should switch to compact mode in narrow terminals');
  assert.match(components, /provider not configured/, 'unconfigured providers should not be represented as a default model');
  assert.doesNotMatch(components, /Note: Launched in home directory\./, 'welcome panel should not claim a fixed launch directory');
});

test('welcome command tips match the discoverable commands', () => {
  assert.match(components, /\/help/, 'welcome panel should advertise help');
  assert.match(components, /Activity appears as tasks run\./, 'welcome panel should not imply the activity feed is populated before tasks run');
});


test('safe init and doctor are registered as CLI subcommands before application startup', () => {
  assert.ok(cli.includes("program.command('doctor')"), 'doctor CLI subcommand should exist');
  assert.ok(cli.includes("program.command('init')"), 'init CLI subcommand should exist');
  const parseIndex = cli.indexOf('program.parse(process.argv)');
  const guardIndex = cli.indexOf('if (!commandHandled) {');
  assert.ok(parseIndex >= 0 && guardIndex > parseIndex, 'subcommands should be parsed before normal application startup');
  assert.ok(cli.includes('ConfigManager.init();') && cli.includes('ensureScopeFile();'), 'normal application startup should still initialize config and scope');
  assert.equal(ui.includes('\nensureScopeFile();'), false, 'importing the UI must not write workspace state before a subcommand is handled');
});


test('CLI, package metadata, and TUI share one version source', () => {
  assert.equal(packageJson.version, '3.0.0', 'package release version should match the current CLI release');
  assert.equal(packageLock.version, packageJson.version, 'lockfile root version should match package.json');
  assert.equal(packageLock.packages[''].version, packageJson.version, 'lockfile root package version should match package.json');
  assert.match(cli, /import \{ APP_VERSION \} from '\.\/version\.js';/);
  assert.match(cli, /\.version\(APP_VERSION\)/, 'Commander should use the shared package version');
  assert.match(components, /import \{ APP_VERSION_LABEL \} from '\.\/version\.js';/);
  assert.match(components, /version = APP_VERSION_LABEL/, 'TUI header should use the shared package version label');
});

test('header, welcome panel, trust gate, and prompt use the shared responsive width', () => {
  assert.match(components, /export function getTerminalLayoutWidth\(columns: number \| undefined\)/);
  assert.match(components, /getTerminalLayoutWidth\(stdout\.columns\)/, 'header should use shared layout width');
  assert.match(ui, /const layoutWidth = getTerminalLayoutWidth\(stdout\.columns\)/);
  assert.match(ui, /<Box flexDirection="column" width=\{layoutWidth\}>\s*<VertexHeader \/>/);
  assert.match(ui, /<Box flexDirection="column" width=\{layoutWidth\} borderStyle="round" borderColor="cyan"/);
  assert.match(ui, /<TrustGate trustCursor=\{trustCursor\} width=\{layoutWidth\} \/>/);
  assert.match(ui, /queuedQueries=\{queuedQueries\}\s*width=\{layoutWidth\}/);
  assert.doesNotMatch(ui, /width=\{97\}|repeat\(97\)|width="100%"/, 'primary layout should not use mismatched hard-coded widths');
});

test('interactive TUI and daemon defer AgentManager loading until an agent task is requested', () => {
  assert.match(ui, /import type \{ AgentManager \} from '\.\/core\/agent\/AgentManager\.js';/);
  assert.match(ui, /const \{ AgentManager \} = await import\('\.\/core\/agent\/AgentManager\.js'\)/);
  assert.doesNotMatch(ui, /^import\s+\{\s*AgentManager\s*\}\s+from\s+['"]\.\/core\/agent\/AgentManager\.js['"]/m,
    'the TUI must not eagerly import offensive-agent dependencies on startup');
  assert.match(daemon, /import type \{ AgentManager \} from '\.\/agent\/AgentManager\.js';/);
  assert.match(daemon, /orchestratorPromise = import\('\.\/agent\/AgentManager\.js'\)/);
  assert.match(daemon, /const manager = await getOrchestrator\(\)/);
  assert.doesNotMatch(agentManager, /^import\s+\*\s+as\s+subagents\s+from\s+['"]\.\.\/\.\.\/agents\/index\.js['"]/m,
    'AgentManager must not eagerly import every specialist');
  assert.match(agentManager, /const SUBAGENT_LOADERS: Record<string, \(\) => Promise<Record<string, unknown>>>/);
  assert.match(agentManager, /const AgentClass = await loadSubagent\(agentName\)/);
  assert.match(agentManager, /const QualityAgent = await loadSubagent\('QualityAgent'\)/);
});

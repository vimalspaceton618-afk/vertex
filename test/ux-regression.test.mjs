import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const ui = fs.readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8');
const cli = fs.readFileSync(new URL('../src/cli.tsx', import.meta.url), 'utf8');
const components = fs.readFileSync(new URL('../src/components.tsx', import.meta.url), 'utf8');

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
  assert.match(cli, /program\.command\('doctor'\)/, 'doctor CLI subcommand should exist');
  assert.match(cli, /program\.command\('init'\)/, 'init CLI subcommand should exist');
  assert.ok(cli.indexOf('program.parse(process.argv)') < cli.indexOf('if (!commandHandled)'), 'subcommands should be parsed before normal application startup');
  assert.match(cli, /if \(!commandHandled\) \{\s*ConfigManager\.init\(\);\s*ensureScopeFile\(\);/, 'diagnostic/setup subcommands must avoid automatic config/scope writes');
  assert.doesNotMatch(fs.readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8'), /^ensureScopeFile\(\);/m, 'importing the UI must not write workspace state before a subcommand is handled');
});

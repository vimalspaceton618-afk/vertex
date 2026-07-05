# Project: Vertex CLI Review and Bug Fixes

## Architecture
Vertex is a multi-agent AI CLI application built using Node.js, TypeScript, and React Ink. It uses `commander` for CLI entry and option parsing in headless mode, and mounts an interactive terminal UI when run without parameters. Specialized subagents (CyberAgent, NyxAgent, DeveloperAgent, PlanAgent, QualityAgent, DevOpsAgent, BrowserAgent, NetworkAgent) are managed by the master orchestrator `AgentManager`.

## Code Layout
- Root directory: `e:\vertex`
- Source files: `src/`
- Build outputs: `dist/`
- Agent metadata: `.agents/`
- Key entrypoints:
  - `src/cli.tsx` (CLI command parser and entry point)
  - `src/ui.tsx` (Interactive TUI app logic)
  - `src/components.tsx` (Reusable Ink component layouts)

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration & Assessment | Codebase inspection, typescript check, and static bug identification | none | DONE |
| 2 | Functional & Runtime Fixes | Fix SharedContext path collision, BrowserAgent stateless session, tool name mismatches, and command injection vulnerabilities in tools | M1 | PLANNED |
| 3 | UI & Layout Fixes | Fix VertexHeader top border misalignment, PromptBar text wrapping, PermissionPrompt instant unmounting, index-key anti-patterns, and the /clear command | M1 | PLANNED |
| 4 | Code Quality & TS Fixes | Modernize tsconfig.json to react-jsx, clean package.json dependencies, remove redundant @ts-ignore, and prune dist/ dead build artifacts | M1 | PLANNED |
| 5 | E2E & Final Validation | Comprehensive E2E test runs, unit verification, and final compliance audit | M2, M3, M4 | PLANNED |

## Interface Contracts
- **Interactive UI**: CLI starts with `node dist/cli.js` when no arguments are provided.
- **Headless mode**: `node dist/cli.js --run "<prompt>"` prints stdout and exits.
- **Auto-approve**: `node dist/cli.js --run "<prompt>" --yes` skips permission prompting.
- **JSON output**: `node dist/cli.js --run "<prompt>" --json` structures output in JSON.

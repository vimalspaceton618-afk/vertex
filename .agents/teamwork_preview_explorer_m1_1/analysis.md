# Vertex CLI Codebase Analysis

## 1. Architecture & Component Modules

Vertex is a multi-agent AI CLI application built using Node.js, TypeScript, and React Ink. It operates as an interactive shell or headless command executor where users can input natural language requests or slash commands, which are parsed and routed to specialized subagents.

### Entry Point
- **`src/cli.tsx`** (compiles to `dist/cli.js`):
  - Initializes configuration and ensures workspace policy files exist.
  - Uses `commander` to parse command-line arguments.
  - Supports **headless mode** via `--run <prompt>` (with optional `--json` output and `--yes` auto-approval flags).
  - Mounts the interactive React Ink application (`<App />`) from `src/ui.tsx` if no prompt is passed.

### Agent Manager & Routing Loop
- **`src/core/agent/AgentManager.ts`** (`AgentManager` class):
  - Extends `BaseAgent`. Acts as the master orchestrator.
  - Registers the `delegate_task` tool, allowing the model to delegate tasks to specialized subagents.
  - Manages direct command routing (e.g. `[ROUTE_DIRECT:CyberAgent]`) parsed from slash commands.
  - Records session history and rolling summaries in `SharedContext`.

### Specialized Agents (`src/agents/`)
Each agent extends `BaseAgent` and registers a specific set of tools tailored to its mission:
- **`CyberAgent`**: Handles system security audits, sandbox execution, port scans, DNS lookups, file integrity, and secrets scans.
- **`NyxAgent`**: Handles offensive security operations (Red Teaming) using tools like Metasploit, Nmap with NSE scripts, Burp Suite, CrackMapExec/NetExec, and Sliver C2.
- **`DeveloperAgent`**: Handles file modification, codebase search, Git management, process checking, and general system administration.
- **`PlanAgent`**: Handles complex task planning and saving plans to the workspace.
- **`QualityAgent`**: Performs testing, linting, and verification of code changes.
- **`DevOpsAgent`**: Handles deployment, server processes, Docker infrastructure, and deployments.
- **`BrowserAgent`**: Crawls, searches, navigate pages, and captures screenshots using Puppeteer.
- **`NetworkAgent`**: Automates external API workflows, webhooks, and queue-like task flows.

### Core Systems (`src/core/`)
- **`BaseAgent.ts`**: The base class for all agents. Implements the LLM calling loop, brain candidate resolution (hybrid/local/cloud model fallback), rate-limit backoff, and tool execution orchestration.
- **`config.ts`**: Implements `ConfigManager` to load, merge, and overwrite settings from `.env` and global configuration.
- **`health.ts`**: Performs readiness checks on environment keys, binaries (git, nmap, sliver), and puppeteer runtimes.
- **`llm.ts`**: Basic orchestrator shell and direct openai client instantiation.
- **`policy/PolicyEngine.ts`**: Evaluates targets (IPs, domains) and tool execution risks against the workspace scope configuration.

### Tool Registry & Implementations (`src/tools/`)
Tools are classes extending `Tool` and implementing `execute()`.
- **`FileSystem.ts`**: File system reads, writes, deletes, and directory listings.
- **`Shell.ts`**: Running host commands securely under user confirmation.
- **`DockerSandbox.ts`**: Running untrusted commands inside isolated Alpine containers (`sandbox_execute` and `safety_sandbox_execute`).
- **`LinuxSecurity.ts`**: Port scanning, DNS resolution, network audits, secrets scans, and file integrity manifests.
- **`OffensiveTools.ts`**: Metasploit console, Burp REST API, NetExec/CME, and Sliver client wrapper.
- **`CodeSearch.ts`**, **`Git.ts`**, **`System.ts`**, **`Vision.ts`**: Codebase search, git commands, process killing, and image analysis.

---

## 2. Key Dependencies

- **`react`** (^19.2.5) & **`ink`** (^7.0.0): TUI component rendering, terminal input hooks (`useInput`, `useApp`), and layout management.
- **`commander`** (^14.0.3): Headless command option parsing.
- **`openai`** (^6.34.0): Core LLM interaction library.
- **`dockerode`** (^4.0.10): Docker engine socket wrapper.
- **`puppeteer`** (^24.40.0): Headless browser execution.
- **`dotenv`** (^17.4.1): Development environment variables injection.
- **`chalk`** (^5.6.2) & **`log-update`** (^8.0.0): Terminal text coloring and log updates.

---

## 3. Configuration & State Infrastructure

### Global Configuration
- **Location**: `~/.vertexcli/config.json`
- **Managed by**: `ConfigManager` in `src/core/config.ts`.
- **Keys**: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `AI_MODEL`, `SHELL_TIMEOUT_MS`, `AUTONOMY_MODE`, `VERTEX_PLUGINS_ENABLED`, etc.

### Workspace Scope Policy
- **Location**: `.vertex_plugins/scope.json` (or `.vertex/scope.json` if `.vertex` is a directory).
- **Managed by**: `PolicyEngine` in `src/core/policy/PolicyEngine.ts`.
- **Function**: Governs allowed CIDR blocks, allowed domains, blocked target subnets, and enabled offensive tools.

### Plugin Policy
- **Location**: `.vertex_plugins/policy.json`
- **Managed by**: `src/plugins/policy.ts`.
- **Function**: Fine-grained autonomy controls for plugin-specific tools (e.g. requiring confirmation per-tool or letting them execute automatically).

### Session Context
- **Location**: `.vertex` (state file in the workspace root).
- **Managed by**: `SharedContext` in `src/core/agent/SharedContext.ts`.
- **Function**: Stores rolling summaries, recent shell commands executed, files touched, and active workflow runs.

---

## 4. TypeScript & React Ink Files

The CLI functionality and TUI rendering are implemented across the following TypeScript/TSX files:
1. **`src/cli.tsx`** — CLI options and headless entry flow.
2. **`src/ui.tsx`** — Interactive app loop, state manager, trust gate, history feed, and input keybindings.
3. **`src/components.tsx`** — Render layouts: header, tool cards, agent monitors, permission cards, and audit findings tables.

---

## 5. Identified Static Issues & Bugs

During code audit and compilation review, the following issues were identified:

### Issue 1: Directory vs File Name Collision on `.vertex`
- **Details**: `SharedContext.ts` checks if `.vertex` exists. If not, it creates it as a *file* containing the session state JSON. However, `PolicyEngine.ts` and `PluginManager.ts` expect `.vertex` to be a *directory* (checking `fs.statSync(vertexDir).isDirectory()`).
- **Impact**: Since `.vertex` is created as a file, the directory checks fail, forcing scope and policy configurations to fall back to the `.vertex_plugins` directory. This splits configuration and state files into two separate paths in the workspace root instead of a clean, unified `.vertex/` folder.

### Issue 2: `PermissionPrompt` Component Instantly Unmounted
- **Details**: In `src/ui.tsx`, when a tool requests confirmation, `App` renders `<PermissionPrompt command={confirmPrompt.message} onResolve={...} />`. The `onResolve` handler immediately calls `setConfirmPrompt(null)` to resume execution.
- **Impact**: This state update triggers an immediate rerender and unmounts `<PermissionPrompt>` instantly. The resolved states inside the component (`✔ Action Approved` / `✖ Action Rejected`) are never rendered on screen, making the prompt disappear instantly without a resolved trace in the CLI.

### Issue 3: `VertexHeader` Layout Width Geometry Misalignment
- **Details**: The header's top border is rendered using `{"─".repeat(72)}` inside a container of width 97. This repeat count is hardcoded to align only when the string `{activeAgent} {version} ` is exactly 21 characters long (which fits the default `"Arrektys Code"` and `"v0.1.6"`).
- **Impact**: When the agent shifts or a different active agent name (e.g., `"CyberAgent"`, 10 chars) is loaded, the top border's width changes, causing the header's right corner to misalign and break the border box geometry.

### Issue 4: Hardcoded Metadata in Welcome Screen
- **Details**: The welcome screen in `VertexHeader` (`src/components.tsx`) has a hardcoded model description (`qwen/qwen3-next-80b-a3b...`) and home directory (`C:\Users\ADMIN`).
- **Impact**: The display does not dynamically reflect the actual `process.env.AI_MODEL` in use or the user's workspace path.

### Issue 5: `Vision.ts` Global Client Bypasses Agent-Specific Brain Configuration
- **Details**: `AnalyzeImageTool` in `src/tools/Vision.ts` calls `getClient()` from `core/llm.ts` instead of using the agent's brain candidates engine.
- **Impact**: In hybrid or local-only configurations where the global `OPENAI_API_KEY` is not set but local credentials are provided, the vision tool will crash on a dummy-key auth failure.

### Issue 6: Clear Command `/clear` Does Not Clear Terminal Screen
- **Details**: Running `/clear` sets the `history` state to `[]`. However, React Ink's `Static` component prints elements permanently to stdout.
- **Impact**: State changes to history do not erase previously printed terminal output. The screen remains occupied by old logs.

### Issue 7: Mismatch Between DeveloperAgent System Prompt and Tool Name
- **Details**: The system prompts for `DeveloperAgent` and `AgentManager` explicitly tell the agent to use the `delete_file` tool to remove files.
- **Impact**: The actual registered tool class `DeleteTool` has the name `delete_file_or_dir`. This discrepancy can cause agents to attempt calling a non-existent tool name `delete_file`.

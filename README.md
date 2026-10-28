# VERTEX

<!-- VERTEX INTERACTIVE OVERVIEW -->
<div align="center">

<a href="https://github.com/vimalspaceton618-afk/vertex"><img src="https://img.shields.io/badge/Explore-VERTEX-7C3AED?style=for-the-badge&logo=github&logoColor=white" alt="Explore VERTEX"></a>
<a href="#quick-demo"><img src="https://img.shields.io/badge/Try-the%20demo-06B6D4?style=for-the-badge&logo=windowsterminal&logoColor=white" alt="Try the demo"></a>
<a href="https://github.com/vimalspaceton618-afk/vertex/issues"><img src="https://img.shields.io/badge/Ideas%20%26%20bugs-Open%20an%20issue-111827?style=for-the-badge&logo=github" alt="Ideas and bugs"></a>

**Think. Delegate. Inspect. Build.**

[Quick start](#quick-start) · [Try the command explorer](#command-explorer) · [Architecture](#architecture) · [Contribute](#contributing)

</div>


[![CI](https://github.com/vimalspaceton618-afk/vertex/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/vimalspaceton618-afk/vertex/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)
![License: Proprietary](https://img.shields.io/badge/license-proprietary-red)

**A terminal-native AI agent workspace for software engineering, research, and authorized security analysis.**

VERTEX brings an interactive terminal UI, task orchestration across specialized agents, browser-based research, workspace configuration, and optional Docker-backed command execution into one developer workflow.

> **Project status:** VERTEX is under active development. Features, commands, and policy controls can change. Review proposed actions, use a disposable workspace for experiments, and do not treat VERTEX or its Docker sandbox as a complete security boundary.

## Contents

- [What VERTEX does](#what-vertex-does)
- [Requirements](#requirements)
- [Install](#install)
- [First run](#first-run)
- [Common workflows](#common-workflows)
- [Commands](#commands)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Security and limitations](#security-and-limitations)
- [Development and tests](#development-and-tests)
- [Contributing](#contributing)
- [Security reports](#security-reports)
- [License](#license)

## Quick demo

Want to see the workflow before installing? Here is a copy-ready example of the kind of interaction to try after launching VERTEX.

<details>
<summary><strong>▶ Demo 1 — Inspect a codebase</strong></summary>

Start VERTEX in a repository you own, then enter:

```text
/audit .
```

Review the returned findings, verify them yourself, and decide which changes to make. The output depends on your configured model, tools, and repository.

</details>

<details>
<summary><strong>▶ Demo 2 — Research a technical question</strong></summary>

```text
/search Node.js security advisories
/summarize-url https://example.com
```

Use the research results as a starting point and confirm important claims against primary sources.

</details>

<details>
<summary><strong>▶ Demo 3 — Run a sandbox command</strong></summary>

```text
/sandbox uname -a
```

Requires a working Docker daemon and the required image. Docker isolation is a defense-in-depth measure, not a guarantee that all workloads are safe.

</details>

## Command explorer

Use this quick reference to jump to the task you want to try. These are Markdown links, so they work directly on GitHub without JavaScript or external scripts.

| I want to… | Try this | Details |
| --- | --- | --- |
| Check my environment | `vertex doctor` | [First run](#first-run) |
| Start the interactive UI | `vertex` | [Install](#install) |
| Audit a repository | `/audit .` | [Common workflows](#common-workflows) |
| Run a command in Docker | `/sandbox uname -a` | [Security notes](#security-and-limitations) |
| Search the web | `/search <query>` | [Commands](#commands) |
| Summarize a URL | `/summarize-url <url>` | [Commands](#commands) |
| View available commands | `/help` | [Commands](#commands) |
| Run regression tests | `npm test` | [Development](#development-and-tests) |

<details>
<summary><strong>Show all installation commands</strong></summary>

```bash
git clone https://github.com/vimalspaceton618-afk/vertex.git
cd vertex
npm ci
npm run build
npm link
vertex doctor
vertex
```

Requires Node.js 22+, npm, and Git. Docker is required for Docker-backed sandbox workflows.

</details>

<details>
<summary><strong>Show the configuration checklist</strong></summary>

- [ ] Run `vertex init` in the intended workspace.
- [ ] Add the required provider settings to the local `.env`.
- [ ] Keep API keys private; never commit `.env`.
- [ ] Run `vertex doctor` to inspect the environment.
- [ ] Review workspace access and tool approvals before using agents.

</details>

## What VERTEX does

- **Interactive terminal UI** — work with agents from a keyboard-driven terminal interface.
- **Agent orchestration** — route coding, research, and security tasks to specialized agents.
- **Developer workflows** — request code analysis, fixes, refactors, and repository-focused assistance.
- **Authorized security analysis** — organize audits and defensive workflows for systems you own or have permission to assess.
- **Browser research** — search the web, inspect URLs, summarize pages, and save screenshots.
- **Docker-backed command execution** — run supported commands in short-lived containers with network access disabled and resource limits applied.
- **Workspace-aware setup** — initialize local configuration and inspect the environment with diagnostic commands.
- **Extensible tools and skills** — use available integrations and local Markdown skills, subject to the project's implementation and policy controls.

## Requirements

- **Node.js 22 or newer**
- **npm** (included with Node.js)
- **Git**
- **Docker Engine/Desktop** for Docker-backed sandbox commands

Docker is optional for the basic CLI and terminal UI. Docker-backed execution requires a working Docker daemon and the required image to be available locally.

## Install

### From source

**macOS / Linux / Windows PowerShell**

```bash
git clone https://github.com/vimalspaceton618-afk/vertex.git
cd vertex
npm ci
npm run build
npm link
vertex --version
vertex
```

`npm link` registers the package's `vertex` executable globally for the current Node/npm installation. Keep the cloned repository in place while using the link.

If the command is not found, check `npm config get prefix`, ensure the npm global executable directory is on your `PATH`, and reopen the terminal. On Windows, the npm global prefix directory must be available on your user `PATH`.

### Install directly from GitHub

To install the current `main` branch as a global command without manually cloning it:

```bash
npm install --global git+https://github.com/vimalspaceton618-afk/vertex.git#main
vertex --version
vertex
```

This installs the version on `main`, which may change as development continues. It is not a version-pinned release.

## First run

From the workspace where you intend to use VERTEX:

1. Create a starter configuration file:

   ```bash
   vertex init
   ```

   This creates `.env` only if it does not already exist. Credential fields are empty, and the file is created with restrictive permissions where supported.

2. Edit `.env` and configure your provider or local model endpoint. Never commit credentials or paste API keys into issues, logs, or chat.

3. Run the environment diagnostics:

   ```bash
   vertex doctor
   ```

   For machine-readable diagnostics, use `vertex doctor --json`.

4. Start the interactive UI:

   ```bash
   vertex
   ```

On first launch, VERTEX asks you to explicitly trust the current workspace. Grant access only to a directory you intend the agent to read or modify.

## Common workflows

### Inspect a repository

In the VERTEX prompt:

```text
/audit .
```

Use the findings to guide a manual review and remediation. Audit results are suggestions and should be verified before being treated as confirmed vulnerabilities.

### Run a command in Docker

```text
/sandbox uname -a
```

The standard Docker sandbox is configured with no container network access, a 256 MiB memory limit, a 64-process limit, dropped Linux capabilities, a timeout, and automatic container cleanup. See [Security and limitations](#security-and-limitations).

### Research a URL

```text
/search Node.js security advisories
/open https://example.com
/summarize-url https://example.com/article
/screenshot-url https://example.com
```

### Use the CLI without the interactive UI

```bash
vertex --run "Summarize the structure of this repository"
vertex --run "Summarize the structure of this repository" --json
vertex doctor --json
```

**Caution:** `vertex --run ... --yes` automatically approves tool confirmations in headless mode. Use it only for trusted prompts in a disposable, controlled environment. Do not use it as a shortcut for running untrusted instructions.

## Commands

The interactive prompt supports the following command families. Use `/help` in VERTEX for the current in-app list and usage.

| Command | Purpose |
| --- | --- |
| `/help`, `/clear`, `/exit` | Help, clear conversation history, and exit |
| `/health`, `/doctor`, `/scope` | Inspect runtime status, environment diagnostics, and policy scope |
| `/init`, `/mode` | Create a local configuration template or inspect/downgrade autonomy mode |
| `/audit [path]` | Request a security audit of a path |
| `/sandbox <command>`, `/safe-sandbox <command>` | Run a command using a Docker-backed sandbox workflow |
| `/search <query>`, `/open <url>` | Search the web or inspect a URL |
| `/summarize-url <url>`, `/screenshot-url <url>` | Summarize a page or save a screenshot |
| `/goal <task>`, `/schedule <...>` | Request bounded goal execution or scheduling |
| `/grill-me`, `/learn` | Clarify requirements or extract learned rules |
| `/skill <...>`, `/skills` | Use supported science lookups or inspect local Markdown skills |
| `/nyx`, `/recon`, `/sentinel`, `/phantom` | Route to specialized security workflows; use only with proper authorization |
| `/loot`, `/attack-graph`, `/gpu` | Access supported data-store, graph, or GPU-job workflows |

Command availability and behavior may vary by version. Check `/help` before relying on a command in an automated workflow.

## Configuration

`vertex init` creates a workspace-local `.env` template. VERTEX also maintains global configuration under `~/.vertexcli/config.json`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Empty | API key for the configured cloud provider |
| `OPENAI_BASE_URL` | Empty | Optional OpenAI-compatible provider endpoint |
| `BRAIN_MODE` | `cloud` | Provider mode: `cloud`, `local`, or `offline` |
| `AI_MODEL` | Runtime default | Optional model identifier |
| `LOCAL_BASE_URL` | `http://127.0.0.1:11434/v1` | Local OpenAI-compatible endpoint, such as an Ollama endpoint |
| `LOCAL_MODEL` | Empty | Model identifier for local/offline mode |
| `WORKSPACE_ROOT` | Empty | Optional workspace-root restriction |
| `SHELL_TIMEOUT_MS` | `60000` | Subprocess timeout in milliseconds |

The starter `.env` documents only the most common settings. Advanced model routing and other runtime options are defined in the source configuration and may change over time.

## Architecture

VERTEX is implemented in TypeScript on Node.js. The terminal UI uses React and Ink. An agent manager coordinates specialized agents and tools; browser workflows use Puppeteer, while sandboxed command execution uses Docker when configured and available.

At a high level:

1. **CLI and TUI** — accept interactive prompts or supported headless commands.
2. **Agent orchestration** — route tasks to agents and tools.
3. **Tool and policy layer** — apply the project's authorization and confirmation rules.
4. **Integrations** — connect supported browser, filesystem, development, and research capabilities.
5. **Execution and state** — use workspace configuration and optional Docker-backed execution.

This describes the intended component boundaries, not a formal security guarantee. Review the implementation and current limitations before using VERTEX in a sensitive environment.

## Security and limitations

VERTEX can read or modify files in a trusted workspace and may invoke tools or subprocesses. Run it with the least privilege practical for your task.

- Use VERTEX only on systems and targets you own or are explicitly authorized to assess.
- Do not point it at production infrastructure, sensitive repositories, or directories containing credentials unless your threat model and access controls permit it.
- Keep API keys in private configuration; never commit `.env` or secrets.
- Review generated commands, code changes, research findings, and agent output before acting on them.
- Prefer a disposable workspace and a separate VM for experiments involving untrusted code.
- Docker isolation reduces exposure but does not guarantee that a workload is safe. Keep the host and Docker installation updated.
- Treat local skills, prompts, scraped pages, and retrieved content as untrusted input.

**Important:** the headless `--yes` flag bypasses interactive tool confirmations. Do not combine it with untrusted prompts or sensitive workspaces. VERTEX is actively evolving; do not assume every tool has identical enforcement semantics or that the project has undergone an independent penetration test.

For details on reporting vulnerabilities, see [SECURITY.md](SECURITY.md).

## Development and tests

Install dependencies, compile the TypeScript source, and run the regression suite:

```bash
npm ci
npm run build
npm test
```

The test script builds the project and runs the Node.js test suites, including UI regression tests. CI also exercises build/test and packaging workflows across supported runner environments. A passing test suite is useful evidence, but it is not proof that every security property holds.

## Contributing

Bug reports, documentation fixes, feature requests, and code contributions are welcome. Before opening a pull request:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md).
2. Keep the change focused and explain its motivation.
3. Add or update tests for behavior changes.
4. Run `npm test` and report any limitations in the PR description.

## Security reports

Please follow [SECURITY.md](SECURITY.md). Prefer GitHub's private vulnerability reporting or security-advisory workflow when available. Avoid publishing exploitable details in a public issue before maintainers can assess them.

## License

VERTEX is proprietary software. The repository's [LICENSE](LICENSE) describes the permitted evaluation/contribution use and restrictions. No open-source license is granted; redistribution or other use beyond the stated permissions requires written permission from the rights holder.

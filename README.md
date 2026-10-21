# VERTEX

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()
[![npm version](https://img.shields.io/npm/v/vertex)]()
[![License](https://img.shields.io/badge/license-UNLICENSED-red)]()

A terminal-native, agentic cybersecurity assistant for code, system auditing, and threat response.

VERTEX runs in your terminal and coordinates specialized subagents to perform tasks such as code audits, sandboxed execution of untrusted scripts, network reconnaissance, and automated browser-based research.

Why VERTEX?
- Fast, TTY-native UI for quick workflows in a developer terminal.
- Hardened Docker-based sandbox for safe execution of untrusted commands and malware research.
- Multi-agent orchestration for security-specific tasks (audit, recon, monitoring, payload testing).

Table of Contents
- Installation
- Quickstart
- Examples
- Core Capabilities
- Agent Architecture
- Security & Sandbox Isolation
- Configuration Reference
- Slash Commands
- Contributing
- License
- Troubleshooting & FAQ
- Roadmap

---

## Installation

### Prerequisites
- Node.js: v20.x or higher (v22+ recommended). Use nvm to manage versions: `nvm install 22 && nvm use 22`
- Git
- Docker (Optional but strongly recommended for sandboxed execution)

> Note: Docker is optional for basic CLI features but required for safe sandboxed runs. Ensure Docker daemon is running before using `/sandbox` functionality.

### Install (macOS / Linux)
```bash
git clone https://github.com/vimalspaceton618-afk/vertex.git
cd vertex
npm ci
npm run build
npm link
```

### Install (Windows - PowerShell)
```powershell
git clone https://github.com/vimalspaceton618-afk/vertex.git
cd vertex
npm ci
npm run build
npm link
```

Run from anywhere:
```bash
vertex
```

---

## Quickstart

1. From the project/workspace directory where you want VERTEX to work, create a local configuration template:
```bash
vertex init
```
This creates `.env` only if it does not already exist, uses user-only file permissions on POSIX systems, and leaves API-key fields empty. It never overwrites an existing `.env`.

2. Edit `.env` and set the provider credentials and optional model/endpoint for your environment. **Never commit `.env` or paste API keys into issues, logs, or chat.**

3. Check the environment without starting an agent task:
```bash
vertex doctor
# Machine-readable output:
vertex doctor --json
```
The doctor checks Node.js, workspace access, configuration-file validity/permissions, provider configuration, Git, and optional Docker availability. It does not print secret values or launch containers/agent tasks.

4. Start VERTEX in that workspace:
```bash
vertex
```

Example session (interactive):
- Prompt: "Audit this repo for exposed secrets"
- VERTEX will run `env_secrets_scan`, present findings, and suggest remediation steps.

CLI quick demo:
```text
$ vertex
VERTEX > /audit .
[CyberAgent] Running secrets scan...
[CyberAgent] Found 1 potential secret in config/.env.example: REDACTED_KEY
[DeveloperAgent] Suggestion: rotate key, add to .gitignore, add pattern to secret rules
```

---

## Examples

- Run command in sandbox:
```bash
/sandbox python3 test_payload.py
# Runs inside ephemeral Alpine container with no network and strict limits
```

- Run full audit (secrets, network cursory scan, file integrity)
```bash
/audit ./src
```

- Screenshot and summarize a URL:
```bash
/screenshot-url https://example.com
/summarize-url https://example.com/blog-post
```

Add more concrete examples for common workflows (copy/paste inputs and sample outputs) so new users can learn quickly.

---

## Core Capabilities

- Agentic Multi-Agent System: CyberAgent, DeveloperAgent, ReconAgent, SentinelAgent, PhantomAgent, BrowserAgent
- Hardened Docker Sandbox: ephemeral Alpine containers, no network, memory/process caps
- Integrated security audits: secrets scanning (`env_secrets_scan`), process inspection (`process_inspect`), file integrity manifests (`file_integrity`)
- Puppeteer-driven BrowserAgent: webpage scraping, screenshots, summarization
- Extensible plugin framework: connectors for GitHub, Slack, and user-defined tool suites

---

## Agent Architecture

| Agent | Role |
|---|---|
| CyberAgent | Security orchestrator — audits & threat analysis |
| DeveloperAgent | Code edits, refactoring, fixes |
| ReconAgent | Network footprinting, OSINT |
| SentinelAgent | Monitoring, integrity verification |
| PhantomAgent | Covert payload testing & research |
| BrowserAgent | Automated web tasks & scraping |

---

## Security & Sandbox Isolation

VERTEX is designed with safety-first defaults, but running analysis tools and untrusted code always carries risk. Follow these rules:
- Use Docker sandboxes for untrusted code — do not run unknown scripts directly on your host.
- Rotate and never commit API keys or secrets to git.
- Limit workspace access and run in constrained accounts or VMs when testing malware.

Sandbox constraints:
- Memory capped at 256 MB
- Process limit capped at 64 PIDs
- All Linux capabilities dropped (CapDrop: ALL)
- No network access inside sandbox containers
- Containers destroyed automatically after execution

Responsible disclosure:
- If you discover a security vulnerability in VERTEX, please use GitHub's private security advisories or open an issue labeled `security`. Add a SECURITY.md to the repo with your preferred contact method.

---

## Configuration Reference

| Variable | Default | Description |
|---|---:|---|
| OPENAI_API_KEY | empty | API key for a cloud LLM provider; keep it private |
| OPENAI_BASE_URL | empty | Optional OpenAI-compatible cloud provider endpoint |
| AI_MODEL | runtime default | Optional model identifier |
| BRAIN_MODE | cloud | Provider mode: `cloud`, `local`, or `offline` |
| LOCAL_BASE_URL | `http://127.0.0.1:11434/v1` in global config | Local OpenAI-compatible endpoint |
| LOCAL_MODEL | empty | Model identifier for local/offline mode |
| WORKSPACE_ROOT | empty | Optional workspace restriction; blank uses the current workspace |
| SHELL_TIMEOUT_MS | 60000 | Subprocess execution timeout in ms |

Run `vertex init` to create a private, workspace-local `.env` template. It intentionally leaves credential fields empty and never overwrites an existing file. Do not commit `.env`; the checked-in ignore rules exclude it.

---

## Slash Commands

Use the interactive slash command interface:

- `/sandbox <cmd>` — Run command inside an isolated Docker container
- `/audit [path]` — Run full audit (secrets + network + integrity + processes)
- `/search <query>` — Web research using BrowserAgent
- `/open <url>` — Inspect a URL (title/metadata)
- `/summarize-url <url>` — Extract & summarize page content
- `/screenshot-url <url>` — Capture a full-page screenshot
- `/health` — Inspect runtime status
- `/doctor` — Check environment/configuration safely
- `/init` — Create a private local `.env` template without overwriting an existing file
- `/help` — Display command menu
- `/exit` — Terminate session

---

## Contributing

Contributions welcome! Please:
1. Read CONTRIBUTING.md and CODE_OF_CONDUCT.md
2. Open issues for bugs or feature requests
3. Create PRs against `main` with a clear description and tests where applicable

Add templates: ISSUE_TEMPLATE.md and PULL_REQUEST_TEMPLATE.md to make contributions consistent.

---

## License

This project is currently UNLICENSED. If you intend to allow reuse, add an appropriate license (MIT, Apache-2.0, or similar). Update the badge and LICENSE file accordingly.

---

## Troubleshooting & FAQ

Q: I see "sandbox: permission denied" when running Docker
A: Ensure your user is in the `docker` group or use `sudo` for Docker commands.

Q: LLM calls time out
A: Check API key, provider URL, and that your quota/plan supports the requested model.

Add a short list of common errors and fixes.

---

## Roadmap & Changelog
- Roadmap: list planned features such as enhanced plugin marketplace, RBAC for multi-user installs, offline model support.
- Keep a CHANGELOG.md tracking releases, fixes, and breaking changes.

---

## Maintainers / Contact
- Maintainer: SpaceTon
- Repo: https://github.com/vimalspaceton618-afk/vertex
- Security contact: use GitHub private security advisories or open a private issue labeled "security"

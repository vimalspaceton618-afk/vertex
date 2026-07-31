<div align="center">

<br/>

```
██╗   ██╗███████╗██████╗ ████████╗███████╗██╗  ██╗
██║   ██║██╔════╝██╔══██╗╚══██╔══╝██╔════╝╚██╗██╔╝
██║   ██║█████╗  ██████╔╝   ██║   █████╗   ╚███╔╝
╚██╗ ██╔╝██╔══╝  ██╔══██╗   ██║   ██╔══╝   ██╔██╗
 ╚████╔╝ ███████╗██║  ██║   ██║   ███████╗██╔╝ ██╗
  ╚═══╝  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
```

**The AI-Powered Cybersecurity CLI**

[![License: UNLICENSED](https://img.shields.io/badge/License-UNLICENSED-red.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://www.docker.com)

</div>

---

## What is VERTEX?

**VERTEX** is an elite, AI-powered cybersecurity command-line interface built on a multi-agent architecture. It gives security professionals and developers a unified terminal interface to audit systems, run threat analysis, execute untrusted code in isolated sandboxes, and orchestrate complex security tasks — all powered by a fleet of specialized AI agents.

VERTEX is not a generic chatbot. It is a purpose-built **cybersecurity operations shell** with deep integration into Linux security tooling, Docker-based isolation, and a modular agent routing engine that delegates tasks to exactly the right specialist.

---

## Interface Preview

<div align="center">

![VERTEX Terminal Interface](docs/screenshot.png)

*Interactive ink-based reactive TTY shell featuring real-time AI Agent orchestration, live status indicators, auto-complete slash commands, and embedded security tooling.*

</div>

---

## Core Features

### 🛡️ Cybersecurity Sandbox
Execute untrusted scripts and commands in an isolated **Alpine Linux Docker container** with zero host exposure:
- **No network access** inside the container
- **256MB RAM cap** and **PID limit of 64**
- All Linux capabilities dropped (`CapDrop: ALL`)
- Container is destroyed immediately after execution
- Graceful fallback to a restricted host process when Docker is unavailable

### 🔍 Linux Security Audit Suite
A built-in suite of 6 security tools accessible directly from the VERTEX shell:

| Tool | Description |
|---|---|
| `dns_lookup` | Verify DNS health, detect hijacking, audit configurations via `dig`/`nslookup` |
| `port_scan` | Map open ports using `nmap` with a native TCP socket fallback |
| `network_audit` | Inspect active connections and listening services via `ss`/`netstat` |
| `file_integrity` | Generate SHA-256 tamper-detection manifests for files and directories |
| `process_inspect` | List and filter running processes to detect unauthorized services |
| `env_secrets_scan` | Detect exposed API keys, JWTs, passwords, and tokens in config files |

### 🤖 Multi-Agent Architecture
VERTEX routes every query to the right specialist agent automatically:

| Agent | Responsibility |
|---|---|
| 🛡️ **CyberAgent** | Security audits, sandbox execution, threat analysis, structured reports |
| 💻 **DeveloperAgent** | Code writing, file modification, system administration |
| 🔍 **ExploreAgent** | Codebase research and file exploration |
| 📋 **PlanAgent** | Complex task decomposition and planning |
| ✅ **QualityAgent** | Testing, linting, and code validation |
| 🚀 **DevOpsAgent** | Deployment, CI/CD, and infrastructure |
| 🌐 **BrowserAgent** | Web interaction and scraping via Puppeteer |
| 📡 **NetworkAgent** | External API orchestration and workflow automation |

### ⚡ Security Slash Commands
Fast, one-command access to the most common security operations:

```bash
/sandbox <command>    # Run any command in a Docker isolation container
/safe-sandbox <cmd>   # Hardened Docker-only safety research sandbox
/audit [path]         # Full security audit: secrets + integrity + network + processes
/search <query>       # Search DuckDuckGo through BrowserAgent
/open <url>           # Open URL and return page title
/summarize-url <url>  # Extract visible page text and summarize it
/screenshot-url <url> # Save full-page screenshot
/health               # Check VERTEX runtime readiness
/help                 # Show all commands and agents
/exit                 # Quit
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   VERTEX Shell (ink)                │
│           React TTY Interface · Multi-Agent OS      │
└────────────────────┬────────────────────────────────┘
                     │ Routes query
        ┌────────────▼────────────┐
        │      AgentManager       │  ← Orchestrator
        │   (delegate_task tool)  │
        └──┬────┬────┬────┬──┬───┘
           │    │    │    │  │
    ┌──────▼─┐ ┌▼──┐ ┌▼──┐ ┌▼──┐  ┌───────────┐
    │  Cyber │ │Dev│ │Plan│ │QA │  │ +4 more   │
    │ Agent  │ │   │ │   │ │   │  │ Agents    │
    └──┬──┬──┘ └───┘ └───┘ └───┘  └───────────┘
       │  │
  ┌────▼─┐ ┌▼──────────────┐
  │Docker│ │ Linux Security │
  │Sandbox│ │ Tool Suite    │
  └──────┘ └───────────────┘
```

---

## Installation

### Prerequisites
- **Node.js** 22+ and **npm**
- **Docker** (optional, for sandboxed execution)
- **nmap** (optional, for port scanning)

### Clone and Build

```bash
git clone https://github.com/vimalspaceton618-afk/vertex.git
cd vertex
npm install
npm run build
```

### Install Globally

```bash
npm link
```

After linking, VERTEX is available system-wide:

```bash
vertex
```

### Configure API Keys

Copy the environment template and fill in your keys:

```bash
cp .env.example .env
```

```env
# Required — Your LLM provider (OpenRouter recommended)
OPENAI_API_KEY=your_key_here
OPENAI_BASE_URL=https://openrouter.ai/api/v1

# AI Model Selection
AI_MODEL=google/gemma-4-26b-a4b-it:free

# Optional — Workspace root override
VERTEX_WORKSPACE_ROOT=/path/to/your/workspace

# Optional — Plugin controls
VERTEX_PLUGINS_ENABLED=connectors,devtools,automation
VERTEX_PLUGINS_DISABLED=

# Optional — Shell security policy
SHELL_TIMEOUT_MS=60000
SHELL_MAX_OUTPUT_BYTES=16000
```

---

## Usage

### Launch VERTEX

```bash
vertex
```

### Security Commands

```bash
# Isolate and run an untrusted command in Docker
/sandbox nmap -sV localhost
/sandbox cat /etc/passwd
/sandbox python3 suspicious_script.py

# Run containment/safety research in a stricter Docker-only sandbox
/safe-sandbox cat /etc/os-release
/safe-sandbox --image python:3.12-alpine python -c "print(2+2)"
/safe-sandbox --image node:22-alpine node -e "console.log(process.version)"

# Run a full security audit on a directory
/audit .
/audit /var/www/html
/audit C:\Users\Admin\project

# Ask the CyberAgent directly in natural language
Scan ports 22 and 443 on 192.168.1.1
Check for leaked API keys in this project
Audit my running services for suspicious connections
Generate a SHA-256 integrity manifest for /etc/nginx
```

### General Commands

```bash
/health     # Runtime readiness check
/help       # Show all commands and agents
/plugins    # List loaded plugin catalog
/search kali linux nmap nse scripts
/open https://example.com
/summarize-url https://example.com
/screenshot-url https://example.com artifacts/screenshots/example.png
/exit       # Quit VERTEX
```

---

## Security Architecture

### Sandbox Isolation Levels

| Level | Method | Network | Filesystem | Use When |
|---|---|---|---|---|
| **Full Isolation** | Docker Alpine | ❌ None | Container only | Untrusted scripts, malware analysis |
| **Restricted Host** | `child_process` + timeout | ✅ Host | Host (workspace) | Docker unavailable |

### Secrets Detection Patterns

VERTEX's `env_secrets_scan` tool detects:
- AWS Access Keys (`AKIA...`)
- OpenAI API Keys (`sk-...`)
- GitHub Tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`)
- JWT Tokens (header.payload.signature format)
- Bearer Tokens
- RSA / EC / OpenSSH Private Keys
- Database passwords in `.env` files

### Audit Report Format

Every `/audit` run produces a structured **CyberAgent report**:
1. **Executive Summary** — 2–3 line threat overview
2. **Findings Table** — Severity · Category · Detail
3. **Recommendations** — Ordered CRITICAL → LOW
4. **Next Steps** — What to investigate or remediate

---

## Plugin System

VERTEX ships with built-in plugins. Configure them via environment variables:

```env
VERTEX_PLUGINS_ENABLED=connectors,devtools,automation,rag
VERTEX_PLUGINS_DISABLED=frontend
```

> **Note:** Plugin tool names (e.g. `cortex_plugin_*`) are internal IDs and may not change between versions to preserve compatibility with existing workflow configurations.

| Plugin | Tools |
|---|---|
| `connectors` | GitHub Issues, PRs, Slack, Notion, SQLite |
| `devtools` | Project doctor, TypeScript diagnostics |
| `automation` | Workflow runner, mesh envelopes, loop planner |
| `rag` | RAG knowledge index status |
| `frontend` | Frontend scaffolding guide |

---

## Environment Reference

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | LLM provider API key |
| `OPENAI_BASE_URL` | — | LLM base URL (e.g. OpenRouter) |
| `AI_MODEL` | `gpt-4o` | Primary model |
| `VERTEX_WORKSPACE_ROOT` | `cwd()` | Workspace root for file operations |
| `VERTEX_PLUGINS_ENABLED` | all | Comma-separated plugin allowlist |
| `VERTEX_PLUGINS_DISABLED` | none | Comma-separated plugin denylist |
| `SHELL_TIMEOUT_MS` | `60000` | Shell command timeout |
| `SHELL_MAX_OUTPUT_BYTES` | `16000` | Max command output size |
| `AUTONOMY_MODE` | `semi_auto` | `semi_auto` or `full_auto_lab` |
| `MESH_SIGNING_KEY` | — | HMAC key for mesh envelope signing |
| `GITHUB_TOKEN` | — | GitHub API token for connectors plugin |
| `SLACK_WEBHOOK_URL` | — | Slack webhook for connector plugin |

---

## License

This software is **UNLICENSED** and proprietary. All rights reserved by **SpaceTon**. Unauthorized copying, distribution, or modification is strictly prohibited.

---

<div align="center">

**VERTEX** · Built by SpaceTon · Cybersecurity CLI for the modern age

</div>

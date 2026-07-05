## 2026-07-04T11:35:32Z
You are Worker 1 (teamwork_preview_worker). Your working directory is e:\vertex\.agents\teamwork_preview_worker_m2.
Your task is to implement the following functional and runtime bug fixes in the Vertex CLI codebase at e:\vertex:

1. **SharedContext.ts Directory vs File Name Collision**:
   Modify `getContextFile()` in `src/core/agent/SharedContext.ts` to always return `path.join(baseRoot, '.vertex', 'state.json')`. This allows `init()` to correctly run `fs.mkdirSync` on the parent directory, making `.vertex` a directory containing `state.json` instead of being created as a file itself.
2. **BrowserAgent.ts Stateless Session**:
   Ensure the Puppeteer browser session remains open across tool executions. Do not close it in the `finally` blocks of page actions (`navigateUrl`, `searchDuckDuckGo`, `summarizeUrl`, `screenshotUrl`). Ensure `closeBrowser` is only called when cleanly shutting down or during cleanup.
3. **Tool Name Harmonization**:
   - In `src/agents/CyberAgent.ts`, rename `- list_dir` to `- list_directory` in the system prompt to match the actual tool name `list_directory`.
   - Search the system prompts in `src/agents/DeveloperAgent.ts` and `src/core/agent/AgentManager.ts` (or other agent system prompts) for any reference to `delete_file` and change it to the correct registered tool name `delete_file_or_dir`.
4. **Command Injection Vulnerabilities**:
   Implement strict input sanitization or use safer execution mechanisms (such as `child_process.execFile` or argument arrays) in the following tools:
   - `dns_lookup` (`src/tools/LinuxSecurity.ts`): Sanitize `host` and `type` arguments.
   - `port_scan` (`src/tools/LinuxSecurity.ts`): Sanitize `host` and `portsArg`.
   - `process_manager` (`src/tools/System.ts`): Sanitize `args.target` to prevent shell injection.
   - `msf_execute`, `sliver_execute`, `cme_execute` (`src/tools/OffensiveTools.ts`): Properly escape arguments or use argument arrays for command spawning on both Windows and Linux platforms.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Please compile and run the project's tests or check compilation after making changes to verify correctness.
Document your changes in e:\vertex\.agents\teamwork_preview_worker_m2\changes.md and write a handoff report e:\vertex\.agents\teamwork_preview_worker_m2\handoff.md. Send a message to the orchestrator (conversation ID: 8fa79c7b-db9f-4d52-a56a-087f6ed03636) once you are done.

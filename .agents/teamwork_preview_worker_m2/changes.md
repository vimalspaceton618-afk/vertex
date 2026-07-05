# Code Changes Log

The following changes have been made to address functional, runtime, prompt, and command injection issues.

## 1. SharedContext Directory/File Name Collision Fix
- **File**: `src/core/agent/SharedContext.ts`
- **Change**: Modified `getContextFile()` to always return `path.join(baseRoot, '.vertex', 'state.json')`.
- **Rationale**: Previously, it would return `.vertex` if the candidate file/directory did not exist, leading to `fs.writeFileSync` writing `.vertex` as a file. Returning `state.json` inside the `.vertex` directory ensures the parent directory `.vertex` is created as a folder containing the JSON file.

## 2. BrowserAgent Stateful Session
- **File**: `src/agents/BrowserAgent.ts`
- **Change**:
  - Made the `browser` and `page` properties `private static`.
  - Removed all `finally` blocks calling `closeBrowser()` from the page actions: `navigateUrl`, `getPageContent`, `screenshotUrl`, and `searchDuckDuckGo`.
  - Updated `closeBrowser()` to modify and close the static `BrowserAgent.browser` and `BrowserAgent.page` references.
- **Rationale**: Persists the Puppeteer session across tool calls, enabling multi-step browser interactions (e.g. navigate and then extract content without resetting the page state).

## 3. Tool Name Harmonization
- **Files**:
  - `src/agents/CyberAgent.ts`
  - `src/agents/DeveloperAgent.ts`
  - `src/core/agent/AgentManager.ts`
- **Change**:
  - In `CyberAgent.ts`, renamed tool reference `- list_dir` to `- list_directory` in the system prompt.
  - In `DeveloperAgent.ts` and `AgentManager.ts`, renamed all references to `delete_file` in the system prompt to the registered name `delete_file_or_dir`.
- **Rationale**: Aligns tool references within LLM system prompts to the actual registered tool names so agents select the correct tool.

## 4. Command Injection Vulnerability Hardening
- **Files**:
  - `src/tools/LinuxSecurity.ts`
  - `src/tools/System.ts`
  - `src/tools/OffensiveTools.ts`
- **Change**:
  - In `LinuxSecurity.ts` (`dns_lookup` and `port_scan`): Implemented strict regex-based inputs validation/sanitization. Target hosts must match `/^[a-zA-Z0-9.\-_\[\]:]+$/`. DNS records type must be within a safe whitelist. Ports argument must match `/^[0-9,\- ]+$/`.
  - In `System.ts` (`process_manager`): Added check for `args.target` to ensure it is either a clean PID (`/^\d+$/`) or a clean process name (`/^[a-zA-Z0-9.\-_]+$/`), preventing any shell syntax characters from being injected.
  - In `OffensiveTools.ts` (`msf_execute`, `sliver_execute`, `cme_execute`): Added `runCommandSafely` helper which spawns executables using child process argument arrays without passing arguments to a shell. Added a shell-style argument splitter `splitArgs` to process `extraFlags` in `cme_execute`.
- **Rationale**: Eliminates command injection risks by avoiding shell interpreter execution of untrusted input and enforcing strict format verification.

# Plan: Vertex CLI Review and Bug Fixes

This plan outlines the approach to review and fix the Vertex CLI located in `e:\vertex`.

## Objectives
1. Resolve functional and runtime errors.
2. Fix UI and layout rendering issues (React Ink).
3. Address TypeScript type errors, syntax issues, and linting warnings.
4. Verify all changes through successful compilation and testing.

## Milestones

### Milestone 1: Exploration & Assessment [DONE]
- **Objective**: Conduct a comprehensive exploration of the codebase to understand architecture, current errors, build command, test framework, and specific bugs.
- **Status**: Completed by Explorers 1, 2, and 3.

### Milestone 2: Resolve Functional and Runtime Errors [PLANNED]
- **Objective**: Fix logic errors, crashes, broken features, and security command injections.
  - **SharedContext.ts**: Return `.vertex/state.json` instead of `.vertex` path directly.
  - **BrowserAgent.ts**: Persist Puppeteer session across tool executions, remove page action close-browser.
  - **Tool Name Mismatches**: Harmonize `CyberAgent.ts` (`list_dir` to `list_directory`), `DeveloperAgent.ts`/`AgentManager.ts` (`delete_file` to `delete_file_or_dir`).
  - **Command Injection**: Sanitize/secure `LinuxSecurity.ts` (`dns_lookup`, `port_scan`), `System.ts` (`process_manager`), and `OffensiveTools.ts` (`msf_execute`, `sliver_execute`, `cme_execute`).
- **Agent**: `teamwork_preview_worker`
- **Output**: Fixed functional code, secure command executions, and persistent browser state.
- **Verification**: Compilation and test runs.

### Milestone 3: Fix UI and Layout Rendering Issues [PLANNED]
- **Objective**: Correct terminal layout glitches, overlaps, and truncations in React Ink components.
  - **VertexHeader**: Compute top border `repeatCount` dynamically based on title length.
  - **PromptBar**: Wrap input elements into a single parent `<Text>` element.
  - **PermissionPrompt**: Store approved/rejected status inside the history array so that unmounting of `confirmPrompt` does not hide the outcome feedback.
  - **Static**: Assign a unique `id` to each `HistoryMessage` to prevent Ink key collision.
  - **/clear**: Execute `console.clear()` or write `\x1Bc` to stdout.
- **Agent**: `teamwork_preview_worker`
- **Output**: Polished UI layout.
- **Verification**: Visual checks and compilation.

### Milestone 4: Code Quality and TS configuration issues [PLANNED]
- **Objective**: Clean up TypeScript compiler errors, linter warnings, package.json dependencies, and dead build files.
  - **tsconfig.json**: Set `"jsx": "react-jsx"`, check DOM library needs.
  - **package.json**: Remove `@types/ink-spinner` dependency.
  - **DevOpsAgent.ts**: Remove redundant `// @ts-ignore`.
  - **Build Output**: Clean `dist/tools/Network.js` and other dead files.
- **Agent**: `teamwork_preview_worker`
- **Output**: Zero TypeScript errors, clean package structure.
- **Verification**: `npm run build` succeeds.

### Milestone 5: E2E and Final Verification [PLANNED]
- **Objective**: Ensure the entire application works seamlessly end-to-end, audited by `teamwork_preview_auditor`.
- **Verification**: Passing all unit/integration/E2E tests, clean audit verdict.

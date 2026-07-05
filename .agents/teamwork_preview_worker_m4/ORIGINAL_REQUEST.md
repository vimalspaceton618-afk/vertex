## 2026-07-04T11:41:57Z
You are Worker 3 (teamwork_preview_worker). Your working directory is e:\vertex\.agents\teamwork_preview_worker_m4.
Your task is to implement the following code quality and TypeScript configuration improvements in the Vertex CLI codebase at e:\vertex:

1. **tsconfig.json Upgrades**:
   - Change `"jsx": "react"` to `"jsx": "react-jsx"` to modernise JSX compilation for React 19.
   - Keep `"skipLibCheck": true` active to bypass React 19 typings compatibility warnings.
   - Verify if removing `"DOM"` from the `"lib"` list compiles cleanly (since this is a Node CLI app). If it compiles without issues, keep it clean.
2. **package.json Cleanups**:
   - Remove `@types/ink-spinner` from the `"dependencies"` block since `ink-spinner` (v5.0.0) ships with native typings.
3. **Source Code Improvements**:
   - Remove the redundant `// @ts-ignore` from line 5 of `src/agents/DevOpsAgent.ts` (above `import Docker from 'dockerode';`).
4. **Dead Artifact Pruning**:
   - Delete `dist/tools/Network.js` (and any related `.js.map` or `.d.ts` files under `dist/tools/Network*`) as they are leftover compiled artifacts from an obsolete file.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Please compile and run the project's build (`npm run build`) after making changes to verify correctness.
Document your changes in e:\vertex\.agents\teamwork_preview_worker_m4\changes.md and write a handoff report e:\vertex\.agents\teamwork_preview_worker_m4\handoff.md. Send a message to the orchestrator (conversation ID: 8fa79c7b-db9f-4d52-a56a-087f6ed03636) once you are done.

# VERTEX Security Audit — Gap Register
Date: 2026-10-22
Scope: Static review of the current `main` source tree and repository CI/test definitions. This is not a penetration test and does not prove the absence of other issues.

## Executive summary
The repository has useful guardrails and regression coverage (workspace path resolver, tool confirmation prompts, scope policy tests, daemon input/origin checks, abort tests, package build and cross-platform install checks). However, the review found material enforcement gaps requiring remediation before treating host execution and agent autonomy as hardened.

## Findings

### VTX-001 — Headless `--yes` bypasses interactive confirmations
**Severity: High when used on untrusted prompts; intended opt-in still needs a documented trust boundary.**
`src/cli.tsx` defines `--yes` and creates a confirmation callback that resolves to `true` when auto-approval is on. That callback is passed through AgentManager to tools; direct commands such as `/safe-sandbox` also use it. With a prompt containing tool instructions, host mutations/commands can be approved without per-action human review.
**Remediation:** default headless mode to deny state-changing tools; make unattended mode require an explicit workspace trust policy and command/tool allowlist; prevent `--yes` from automatically approving destructive, external, persistence, credential, or arbitrary host-shell actions. Add adversarial integration tests proving unsafe tools stay blocked in headless mode.

### VTX-002 — Host shell executes arbitrary command strings
**Severity: High.**
`src/tools/Shell.ts` uses `child_process.exec(command)`, which invokes a shell. The user approval prompt is useful but not a strong enforcement boundary for prompt-injected or unattended flows; allow/deny lists match substrings rather than parsed command/argv.
**Remediation:** prefer `execFile`/spawn with an executable+argv schema for known operations; for a general shell, require an explicit, isolated execution mode and a separate approval policy. Do not rely on substring allowlists as a security boundary. Add tests for quoting, command chaining, nested shells and allowlist bypass cases.

### VTX-003 — Filesystem tools have path TOCTOU windows
**Severity: High for hostile concurrently-modified workspaces.**
`resolveInsideWorkspace()` validates the deepest existing ancestor, but `ReadFileTool`, `WriteFileTool`, and `DeleteTool` use path-based operations after validation/awaiting confirmation. An attacker able to change symlinks or directory entries during the gap may cause a later operation to act on a different object. `WriteFileTool` also recursively creates parent directories after its path was resolved.
**Remediation:** use descriptor-relative/open flags where available; for reads verify opened file descriptor and cap read size; for writes, validate parent and open with exclusive/no-follow flags as appropriate; revalidate immediately before destructive operations. Where cross-platform race-free primitives are not available in Node, document the residual risk and narrow allowed workspace permissions. Add race-oriented regression tests.

### VTX-004 — Authorization logic is split across policy systems
**Severity: High.**
`src/core/policy/PolicyEngine.ts` enforces target scope and risk-based confirmation for selected tools. `src/plugins/policy.ts` independently exposes a permissive `defaultAllow: true` policy and supports `full_auto_lab` with confirmations disabled. The reviewed `ShellTool` relies on its own confirmation and command substrings and does not call the central `enforceToolPolicy()`. This makes security semantics tool-dependent and creates opportunities for policy drift.
**Remediation:** introduce one mandatory policy dispatcher for every tool invocation, default-deny unknown tools, validate the risk classification centrally, and distinguish UI confirmation from authorization. Make full-auto mode opt-in, bounded and visibly reported; ensure unknown mode values fail closed consistently across both policy systems.

### VTX-005 — Scope policy file trust and validation are weak
**Severity: Medium–High.**
`getScopePath()` follows the legacy `.vertex` path through `statSync`; `ensureScopeFile()` writes the scope file without restrictive modes/symlink checks; `loadScope()` accepts array fields based only on `Array.isArray` and uses a cast for the mode. A local user able to modify workspace config can broaden allowed targets or set `unrestricted_lab`.
**Remediation:** reuse the hardened config/state-file pattern: reject symlinked config directory/file, use private permissions, validate every field/type/value and enum, fail closed on malformed scope, and add tampering/permission/symlink tests.

### VTX-006 — Delegated workflow can claim phase completion without reliable evidence
**Severity: Medium.**
`EngageTaskTool` derives phase success by substring checks on agent output (`[ERROR]` and `FAILED`) and returns a completion message after iterating. Textual output is not a trustworthy status signal; a failed or skipped phase can be marked successful.
**Remediation:** return structured typed results with explicit status/exit metadata from each step, stop or require review on indeterminate outcomes, and test failure/cancellation propagation.

### VTX-007 — Audit trail stores sensitive raw data
**Severity: Medium.**
The host shell appends the full command string to session memory and writes command content to audit history; other agents log targets/prompts and delegated outputs. Commands may contain credentials, tokens, private paths, or payloads. State file permission hardening reduces exposure but does not redact secrets.
**Remediation:** use structured audit events with secret redaction and length limits by default; record command hash/executable/argv summary instead of raw secrets; keep a deliberate opt-in debug mode for raw command history.

### VTX-008 — CI does not show an explicit static-analysis/security-scan gate for source
**Severity: Medium (coverage gap, not a confirmed exploit).**
CI builds and runs tests, reports npm advisories and checks high/critical dependency advisories. The workflow as reviewed does not visibly run a dedicated TypeScript lint/static-analysis rule set or SAST query pack.
**Remediation:** add TypeScript-aware linting, CodeQL or another SAST stage, dependency/license policy as appropriate, and ensure all security tests are included in every platform matrix where practical.

## Strengths observed
- `PathSecurity.resolveInsideWorkspace()` addresses straightforward traversal and symlink-ancestor escapes and has regression tests.
- Daemon payloads reject malformed prompt types/lengths and do not accept request-provided approval flags.
- The scope policy checks explicit blocked targets before relaxing restrictions in lab mode.
- Cancellation paths and multi-platform installation have integration/regression tests.
- Memory hardening follow-up now adds real-newline/control-character regression assertions; CI is passing for core build/test and most package jobs, with final Windows install job still being checked at audit time.

## Required order of work
1. Close VTX-001 and VTX-004 first: no approval bypass and one default-deny authorization path.
2. Close VTX-003 and VTX-005: filesystem race reduction and trusted scope config.
3. Close VTX-002: replace or isolate arbitrary shell execution; update all callers.
4. Close VTX-006 and VTX-007: structured completion and redacted audit trail.
5. Add/verify VTX-008 and run full CI on the audit-remediation branch.

## Limits
- Findings are based on source/static inspection through GitHub; no local execution, live exploitation, dependency SBOM deep analysis, or production environment inspection was performed.
- Severity reflects plausible impact in this agentic tool context; finalize CVSS only after threat model and exploitability validation.

# Vertex CLI TUI architecture audit

Baseline is GitHub main at `b810bab1cfd57295e62c342d6de86d81197fb9d9`. This worktree uses the npm lockfile with React 19.2.5, Ink 7.0.0 and TypeScript 6.0.2. Validation ran on Linux with Node 24.22.3. The Git checkout is shallow. Searches of the available repository found no Rust sources or Cargo manifest.

## Entry points and ownership

| Area | Observed contract |
|---|---|
| Interactive entry | `src/cli.tsx` parses with Commander, lazy-loads `App` from `src/ui.tsx`, mounts it with Ink `render` and waits on `waitUntilExit`. |
| Non-interactive | `runHeadless` handles `--run`, `--json`, and `--yes`. Commander owns `doctor`, `review`, and `init`. `--daemon` has a distinct startup and signal lifecycle. |
| Layout and theme | `src/components.tsx` supplies the header, width calculation, progress, result and approval components. `src/ui.tsx` owns the welcome, active stream, transcript and prompt. Both use literal Ink colors. |
| Input | `PromptBar`, `handleCharInput`, `submitPrompt`, and `recallPromptHistory` share state in `App`. History is process-local, capped at 80 entries. Cursor offsets currently operate on UTF-16 indices. |
| Runtime | `getOrchestrator` lazily creates `AgentManager`. `runDelegatedStream` reads either the existing daemon stream or `AgentManager.delegateTask(input, confirmation, signal)`. Both expose text chunks to the UI. |
| Sessions | `AgentManager.recordTurn` delegates last-turn data, rolling summary and audit recording to `SharedContext`. `BaseAgent` owns model conversation history. `SessionManager` serves separate reporting and replay functions. No interactive session picker is wired at this boundary. |
| Terminal cleanup | Ink owns interactive rendering and raw mode. `App` uses `useApp().exit()` and a task-local AbortController. Daemon SIGINT/SIGTERM handlers belong to the CLI's daemon branch. |
| Tests | `node:test` covers CLI startup, headless paths, package entry point, UX and security regressions. Native Electron has a separate smoke test. |

## Commands and dispatch

The existing menu is the `COMMANDS` table beside `handlePrompt` in `src/ui.tsx`. Menu entries and dispatch are maintained separately.

| Command family | Actual handoff |
|---|---|
| /help, /?, /clear, /exit, /quit | Local help, existing history reset or Ink exit |
| /doctor, /init, /health, /scope, /mode | Existing diagnostics, setup, health and policy APIs |
| /search, /open, /summarize-url, /screenshot-url | Existing browser handlers |
| /skill, /skills | Existing science-tool and workspace skill handlers |
| /sandbox, /safe-sandbox, /audit, /nyx, /phantom, /sentinel, /recon, /loot, /attack-graph | Existing command handlers and runtime pathways |
| /goal, /schedule, /grill-me, /learn, /gpu | Existing delegation and command handlers |

The command dispatch and shell execution branches are protected even though they live in the TUI file. No model selector, theme selector or session selector is wired. The command menu should project existing capabilities without introducing new execution paths.

## Event and approval mapping

| UI concern | Authoritative input | Implementation boundary |
|---|---|---|
| Assistant stream | Existing async text iterator or daemon response reader | Batch only display updates. Keep accepted text and final response order. |
| Turn state | UI task start, completion, errors and AbortController | Use per-turn presentation identity. Prevent late updates from reaching a newer turn. |
| Tool activity | Text in the interactive stream. No structured tool lifecycle contract reaches App. | Render observed text. Structured status, IDs and diffs require an existing authoritative source or an approved extension. |
| Approval | Existing `(message: string) => Promise<boolean>` callback | Show the actual string and send one existing boolean decision. The callback carries no runtime request ID or persistent approval options. |
| Cancellation | Existing abort signal and permission denial callback | Keep task interruption and approval denial distinct. |
| Status metadata | Existing configured model and current working directory, plus existing mode APIs | Show only values supported by those sources. |

Current built-in approval input accepts Y/N and Escape in a separate Ink handler. The main handler yields to the approval dialog after its emergency-exit handling. The current multiline input path can interpret pasted lines as submissions, including at startup. Ink 7.0.0 exports `usePaste`, making an isolated clipboard input path feasible without changing the permission engine. Approval focus, paste and duplicate-event tests are necessary before changing keyboard ownership.

## Change boundaries

**Editable:** View components and presentation state in `src/ui.tsx` and `src/components.tsx`, plus UI-local themes and display helpers and relevant tests under `test/`.

**Protected:** `src/core/`, `src/agents/`, `src/tools/`, `src/plugins/`, `desktop/`, the CLI parser and headless/daemon branches in `src/cli.tsx`, and the execution, trust and persistence wiring in `src/ui.tsx`. Package and lockfile changes require a demonstrated dependency need.

Dependency direction is Ink views → UI-local input/display state → existing task and confirmation callbacks → existing runtime. The first implementation phase can add semantic theme tokens alongside existing views without adding dependencies. Streaming and input changes should follow in separate patches.

## Baseline evidence

- `npm test` built the CLI and passed 74 tests. The script reran seven UX tests successfully.
- The 13 desktop regression tests passed.
- Live Linux PTY startup reached the welcome screen at 108 × 36. Automated interactive integration exercised trust and command help.
- `--version` returned 3.0.0. `--help` listed the existing CLI subcommands. `doctor --json` parsed as JSON.
- Baseline failure: `--run /scope`, `--run /scope --json`, and `--run=/scope --json` print Commander help and leave stdout empty in this checkout. The parser is a protected boundary. A separate approved change should let valid root action flags reach the existing `runHeadless` branch and test the public text and JSON contracts.
- Model selection and interactive session restoration have no baseline picker in this checkout. Live provider cancellation and approval denial, Windows/macOS terminal checks and performance profiling remain to be exercised. No new benchmark result is claimed.

## Phase 1 theme controls

Vertex defaults to `warm-dark`. Set `VERTEX_UI_THEME` before startup to select
`warm-light`, `midnight`, `high-contrast-dark`, `high-contrast-light`, or
`terminal`. `NO_COLOR` and `TERM=dumb` suppress palette colors.
`VERTEX_UI_ASCII=1` selects ASCII prompt and task symbols.
`VERTEX_UI_REDUCED_MOTION=1` disables animated activity indicators.

First-run interactive sessions now preview and save a palette before asking
for workspace trust. The `/theme` command reopens the picker. Earlier native
scrollback retains the palette it was rendered with.

## Phase 2 shell

The welcome is committed once through the existing Ink Static transcript.
Ink's window-size hook supplies live dimensions for the active region.
The footer reads the existing autonomy mode and configured model, with
approval or interruption hints given priority over metadata. Narrow or
short terminals use a compact workspace trust view.

Linux PTY startup was verified at 120 × 30, 80 × 24, 35 × 15 and 28 × 10.
The CLI suite passed 76 tests and reran six UX tests successfully. Native
Windows terminal behavior, live resizing and terminal restoration after a
fatal error were not validated in this phase.

## Phase 3 transcript and streaming

The existing text stream now feeds a 50 ms presentation batch per active
assistant message. A message is updated by its presentation ID. Scrollback
commits the finalized prefix, and the existing approval callback flushes
pending text before displaying a request. Cancellation preserves partial
text and prevents stale completion from updating a later turn.

The CLI suite passed 78 tests and reran six UX tests. A Linux PTY session
using a local fixture daemon verified partial output, Escape cancellation,
a subsequent response containing Tamil, and rejection of a late chunk.
Markdown formatting, structured tool events and full terminal-control
sanitization are outside this patch and still pending.

## Prompt editor and command discovery

Ink's bracketed paste hook remains active through trust and approval views,
where paste is ignored. Once trusted, paste inserts a normalized draft.
The prompt supports Ctrl+J for a newline, grapheme-aware cursor movement
and deletion, and restores the original draft after history recall.

The slash menu uses the existing command list. Arrow keys move the
selection, Tab puts the selected name in the draft, and Enter submits an
exact command. Incomplete matches stay in the draft. Unknown command
tokens are rejected at the interactive input boundary.

The CLI suite passed 80 tests. A Linux PTY also verified paste isolation,
multiline entry, and explicit command completion. Vertical movement
within a multiline draft, bounded large-paste rendering, in-session
theme selection, and the full approval regression matrix remain open.

## Approval input

The interactive dialog now requires a selection and a separate Enter.
Escape still denies. Decisions are guarded once per mounted request and
approval summaries show control characters as visible escapes. The existing
callback still receives the original boolean decision.

A Linux PTY fixture verified bracketed paste isolation, bare Enter,
duplicate Enter, a fresh selection on a replacement request and Escape
denial. The full CLI suite passed 81 tests. This fixture tests the dialog
with a stub callback. It does not exercise a live provider permission flow.

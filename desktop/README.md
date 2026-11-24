# Vertex Desktop

Vertex is a desktop coding workspace with a source editor, task-aware pixel companion, and configurable chat-completions provider. The terminal CLI/TUI remains available separately.

## Complete workflow

1. Open a trusted Git repository and describe a task.
2. Discover tracked source files. Paths are ranked by task keywords; up to 80 supported text files are offered from the first 1,000 ranked paths. Hidden paths, links, binaries, and files over 24 KB are excluded.
3. Select 1–12 relevant files and preview the exact JSON source payload (32,000 characters maximum). The task is also sent. A typed API key lasts for the session. Save provider securely encrypts it for the current Windows user and binds it to the full base URL. The portable ZIP contains no user settings. Use a local HTTP endpoint or an HTTPS endpoint and enter its exact model ID.
4. Generate a coordinated patch, review each before/after pair, and approve application in the native dialog. This milestone edits existing files, with one unique replacement region per file. Include a larger region for related edits within one file.
5. Enter your project's test command and approve the exact command and working directory. Vertex shows output, exit code, termination reason, and duration. Commands run with your user permissions, with a two-minute / 512 KB limit. A zero exit code verifies that command, not overall task correctness.

Use Open source file to edit an existing supported file in the selected repository. Save checks for external changes. Type `/help` in the task box for desktop commands. The cat walks in its own strip during operations. Click it or use **pspsps** to call it.

## Recovery

Vertex checks every source snapshot before any write, then checks each file again before replacement. Original and proposed contents are recorded in `patch-recovery.json` in Electron's user-data directory before applying. On a write failure, already applied files are restored when they still contain the proposed content. Concurrently changed files are preserved and reported for manual recovery. A failed rollback blocks subsequent patches until resolved. On restart, the desktop offers recovery of interrupted work. The journal contains source code but no API key. Keep it until recovery is complete; successful or recovered journals are replaced by the next application.

This is recovery across multiple individually atomic file replacements, not an atomic filesystem transaction. External editors should remain idle during application. Newly created/deleted files and automated test-failure repair are not supported yet.

## Development

From the repository root: `npm ci`, then copy `dist/workspace-review.cjs` to `desktop/workspace-review.cjs`. In `desktop`, run `npm install` and `npm start`.

Dependency-free desktop regression checks:

```
node --test desktop/provider.test.cjs desktop/deepseek.test.cjs desktop/workspace-edit.test.cjs desktop/workflow.test.cjs
```

The regression fixture creates a Git repository with an implementation and a test, applies both edits, runs Node against the project test, and verifies the result. It also tests stale files, injected partial failures, concurrent edits, restart recovery, context validation, and nonzero command results. Provider tests use mocked responses; they do not establish live-model performance.

`.github/workflows/desktop-preview.yml` builds the Windows installer and portable `Vertex-win-x64.zip` on pushes to `work/**` or `main`. The preview is unsigned. No competitor benchmark has been run.


## Studio visual system

Vertex Studio uses an original sage-and-carbon interface: a dedicated project sidebar, focused task composer, four-stage review flow, persistent guide, and a pixel cat in the activity rail. The default is a light technical workspace, with an optional dark mode toggle. The theme preference is stored locally and never contains credentials; provider keys continue to use the existing OS-backed secure store. Click the model badge or **Model provider** in the sidebar to open endpoint, key, and model settings. **Ctrl/⌘ + Enter** in the task field discovers context after a repository is selected. All existing provider, editor, patch approval, test approval, recovery, and slash-command flows are retained.

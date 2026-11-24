# Vertex Desktop

Vertex is a desktop coding workspace backed by DeepSeek. The terminal CLI/TUI remains available separately.

## Complete workflow

1. Open a trusted Git repository and describe a task.
2. Discover tracked source files. Paths are ranked by task keywords; up to 80 supported text files are offered from the first 1,000 ranked paths. Hidden paths, links, binaries, and files over 24 KB are excluded.
3. Select 1–12 relevant files and preview the exact JSON source payload (32,000 characters maximum). The task is also sent. The API key stays in memory.
4. Generate a coordinated patch, review each before/after pair, and approve application in the native dialog. This milestone edits existing files, with one unique replacement region per file. Include a larger region for related edits within one file.
5. Enter your project's test command and approve the exact command and working directory. Vertex shows output, exit code, termination reason, and duration. Commands run with your user permissions, with a two-minute / 512 KB limit. A zero exit code verifies that command, not overall task correctness.

## Recovery

Vertex checks every source snapshot before any write, then checks each file again before replacement. Original and proposed contents are recorded in `patch-recovery.json` in Electron's user-data directory before applying. On a write failure, already applied files are restored when they still contain the proposed content. Concurrently changed files are preserved and reported for manual recovery. A failed rollback blocks subsequent patches until resolved. On restart, the desktop offers recovery of interrupted work. The journal contains source code but no API key. Keep it until recovery is complete; successful or recovered journals are replaced by the next application.

This is recovery across multiple individually atomic file replacements, not an atomic filesystem transaction. External editors should remain idle during application. Newly created/deleted files and automated test-failure repair are not supported yet.

## Development

From the repository root: `npm ci`, then copy `dist/workspace-review.cjs` to `desktop/workspace-review.cjs`. In `desktop`, run `npm install` and `npm start`.

Dependency-free desktop regression checks:

```
node --test desktop/deepseek.test.cjs desktop/workspace-edit.test.cjs desktop/workflow.test.cjs
```

The regression fixture creates a Git repository with an implementation and a test, applies both edits, runs Node against the project test, and verifies the result. It also tests stale files, injected partial failures, concurrent edits, restart recovery, context validation, and nonzero command results. Provider tests use mocked responses; they do not establish live-model performance.

`.github/workflows/desktop-preview.yml` builds the Windows installer and portable `Vertex-win-x64.zip` on pushes to `work/**` or `main`. The preview is unsigned. No competitor benchmark has been run.

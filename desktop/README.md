# Vertex Desktop preview

Open a trusted Git repository to review its staged and unstaged changes. The desktop and `vertex review [directory] --json` use the same workspace review module. Git must be on PATH for review. Use the Windows ZIP for a portable preview.

## DeepSeek coding

Open a trusted Git workspace, choose a small UTF-8 source file, enter a task and a DeepSeek API key, and request an edit. Vertex sends the selected file and task to the DeepSeek API. Review the before and after snippets, then confirm the edit in the desktop dialog. Vertex checks that the source is still current and refreshes the Git review. The pasted-code workflow returns a text proposal.

## Windows developer build

From the repository root, build with `npm ci`. Copy `dist/workspace-review.cjs` into `desktop/`, then run `npm install` in that directory. Use `npm start` for development or `npm run make` for the Windows package. The Forge output directory is `desktop/out`.

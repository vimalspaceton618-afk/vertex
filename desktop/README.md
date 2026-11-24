# Vertex Desktop preview

Open a trusted Git repository to review its staged and unstaged changes. The desktop and `vertex review [directory] --json` use the same workspace review module. Git must be on PATH for review. Use the Windows ZIP for a portable preview.

## Windows developer build

From the repository root, build with `npm ci`. Copy `dist/workspace-review.cjs` into `desktop/`, then run `npm install` in that directory. Use `npm start` for development or `npm run make` for the Windows package. The Forge output directory is `desktop/out`.

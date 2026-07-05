# Changes List

## TypeScript Configuration (`tsconfig.json`)
- Updated `"jsx"` from `"react"` to `"react-jsx"` to modernize JSX compilation for React 19.
- Retained `"skipLibCheck": true` to prevent compatibility warnings from React 19 typings.
- Tested the removal of `"DOM"` from the `"lib"` compiler option. The build failed with errors due to `src/agents/BrowserAgent.ts` using `document` and `window` globals in browser contexts within `page.evaluate(...)` closures. Restored `"DOM"` to the `"lib"` array (`["ES2022", "DOM"]`) to maintain clean compilation.

## Dependency Cleanup (`package.json`)
- Removed `"@types/ink-spinner": "^3.0.5"` from the `"dependencies"` block because the `ink-spinner` dependency at version `^5.0.0` includes native TypeScript definitions.

## Code Quality (`src/agents/DevOpsAgent.ts`)
- Removed the redundant `// @ts-ignore` directive above the `import Docker from 'dockerode';` statement, as `dockerode` typings resolve correctly.

## Cleanup of Obsolete Build Artifacts
- Deleted the obsolete compiled file `dist/tools/Network.js` and ensured no other matching `Network*` build artifacts remain in `dist/tools/`.

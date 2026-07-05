# Changes Log

## Files Modified
1. `src/components.tsx`:
   - Change the hardcoded top border repeat count `72` to dynamically compute: `const repeatCount = Math.max(0, 91 - activeAgent.length - version.length);`
   - Render: `<Text color="cyan">{"─".repeat(repeatCount)}╮</Text>`
   - Dynamically display the current active AI model (`process.env.AI_MODEL || 'gpt-4o'`) and the current working directory (`process.cwd()`) instead of hardcoded values.
2. `src/ui.tsx`:
   - Wrap sibling `<Text>` nodes inside `PromptBar` into a single parent `<Text>` node:
     ```tsx
     <Text>
       <Text>{beforeCursor}</Text>
       <Text backgroundColor="cyan" color="black">{cursorChar}</Text>
       <Text>{afterCursor}</Text>
     </Text>
     ```
   - Update `onResolve` handler of `PermissionPrompt` to append a visual feedback log to `history` before clearing the confirm prompt.
   - Update `HistoryMessage` type to include a unique `id: string`.
   - Update `appendTurn`, `updateLastAssistant`, and other history updating places to assign/preserve unique IDs.
   - Use `key={h.id}` instead of `key={i}` in the `Static` list.
   - Implement scrollback clearing on the `/clear` command block using `process.stdout.write('\x1Bc')`.
   - Modify the input handling in `useInput` to handle exit hotkeys (`Ctrl+C`) before the `isStreaming` early return.

## Build Status
- **Last known build status**: Compiled successfully via `npm run build` (`tsc`).
- **Errors/Warnings**: None.

## Pending Issues
- **None**: All task requirements successfully implemented and verified.

# Comprehensive Static Analysis & Bug Report — Vertex CLI Codebase

This report documents visual/layout rendering issues and functional/runtime logic bugs identified in the Vertex CLI codebase through static analysis.

---

## 1. React Ink Layout and Rendering Bugs

### Finding 1.1: `VertexHeader` Hardcoded Width and Top Border Misalignment
* **File Path:** `src/components.tsx`
* **Line Range:** 14-25, 68-71
* **Observation:**
  ```tsx
  14: export const VertexHeader: React.FC<{ version?: string; activeAgent?: string }> = ({
  15:   version = 'v0.1.6',
  16:   activeAgent = 'Arrektys Code'
  17: }) => {
  18:   return (
  19:     <Box flexDirection="column" width={97}>
  20:       {/* Top Border with Title */}
  21:       <Box flexDirection="row">
  22:         <Text color="cyan">╭─ </Text>
  23:         <Text color="cyan" bold>{activeAgent} {version} </Text>
  24:         <Text color="cyan">{"─".repeat(72)}╮</Text>
  ```
  The header box width is fixed to `97`. The repeat count of `─` in the top border is hardcoded to `72` based on default values of `activeAgent` ("Arrektys Code", length 13) and `version` ("v0.1.6", length 6).
  * **Resulting Issue:** If `activeAgent` or `version` change in length (e.g. customized by active agent routing or version updates), the top border's width will not sum to 97. It will overflow or underflow, causing the right edge `╮` to misalign visually with the rest of the borders.
  * **Fix Strategy:** Dynamically calculate the repeat count based on the string lengths:
    ```tsx
    const borderPadding = 3 + 1 + 1 + 1; // "╭─ " (3), space (1), space (1), "╮" (1)
    const repeatCount = Math.max(0, 97 - borderPadding - activeAgent.length - version.length);
    // Render top border:
    <Text color="cyan">{"─".repeat(repeatCount)}╮</Text>
    ```

---

### Finding 1.2: `PromptBar` Sibling Text Wrapping Layout Corruption
* **File Path:** `src/ui.tsx`
* **Line Range:** 51-61
* **Observation:**
  ```tsx
  51:         {input.length > 0 ? (
  52:           <Box>
  53:             <Text>{beforeCursor}</Text>
  54:             <Text backgroundColor="cyan" color="black">{cursorChar}</Text>
  55:             <Text>{afterCursor}</Text>
  56:           </Box>
  ```
  * **Resulting Issue:** In Ink, placing sibling `<Text>` components inside a `<Box>` (default row flex direction) makes them individual flex items. When the user enters a long line exceeding the terminal width, Ink cannot wrap them seamlessly like a single paragraph. Sibling `<Text>` elements will wrap as block blocks or truncate, causing the terminal cursor block (`cursorChar`) to split onto a new line, distorting the input field completely.
  * **Fix Strategy:** Nest the `<Text>` components inside a single parent `<Text>` node:
    ```tsx
    <Text>
      <Text>{beforeCursor}</Text>
      <Text backgroundColor="cyan" color="black">{cursorChar}</Text>
      <Text>{afterCursor}</Text>
    </Text>
    ```
    This enables Ink to format and word-wrap the text dynamically as a single inline block.

---

### Finding 1.3: `PermissionPrompt` Transient Status Rendering / Instant Unmount
* **File Path:** `src/components.tsx` (lines 190-207), `src/ui.tsx` (lines 465-474)
* **Observation:**
  In `PermissionPrompt`, when user input `y` or `n` is detected:
  ```tsx
  181:     if (input.toLowerCase() === 'y') {
  182:       setStatus('approved');
  183:       onResolve?.(true);
  ```
  `onResolve` resolves the prompt and immediately updates the parent state:
  ```tsx
  468:             onResolve={(approved) => {
  469:                 confirmPrompt.resolve(approved);
  470:                 setConfirmPrompt(null);
  471:             }}
  ```
  * **Resulting Issue:** Setting `confirmPrompt` to `null` triggers a re-render in `App`, which unmounts `<PermissionPrompt>` instantly. Because of this, the approved/rejected states inside `PermissionPrompt` (lines 190-207) are unmounted before they can be rendered. The prompt vanishes from screen, leaving no green "✔ Action Approved" or red "✖ Action Rejected" feedback on the console.
  * **Fix Strategy:** Update the parent's `history` state to include the approval/rejection feedback message as a persistent line before unmounting, or implement a state transition delay in the parent before unmounting the prompt.

---

### Finding 1.4: `Static` Key Anti-Pattern using Array Index
* **File Path:** `src/ui.tsx`
* **Line Range:** 446-454
* **Observation:**
  ```tsx
  446:       <Static items={isStreaming ? history.slice(0, -1) : history}>
  447:         {(h, i) => (
  448:           <Box key={i} marginY={1} flexDirection="column">
  ```
  * **Resulting Issue:** Using index `i` as the React key for `Static` items is an anti-pattern. Ink uses keys to determine which items in `Static` have already been written to stdout. Using index keys means key identifiers match index values (`0, 1, 2...`), which can cause Ink to misidentify new elements, duplicate outputs, or skip outputs when elements are cleared or appended.
  * **Fix Strategy:** Add a unique `id` field to each `HistoryMessage` (e.g. `msg-${Date.now()}-${Math.random()}`) and use `key={h.id}`.

---

## 2. Functional and Runtime Logic Bugs

### Finding 2.1: `SharedContext` creates `.vertex` File instead of Directory
* **File Path:** `src/core/agent/SharedContext.ts`
* **Line Range:** 31-53
* **Observation:**
  ```typescript
  31:     static getContextFile(): string {
  32:         const baseRoot = process.env.VERTEX_WORKSPACE_ROOT?.trim() || process.cwd();
  33:         const candidate = path.join(baseRoot, '.vertex');
  34:         if (fs.existsSync(candidate)) {
  35:             try {
  36:                 const st = fs.statSync(candidate);
  37:                 if (st.isDirectory()) {
  38:                     return path.join(candidate, 'state.json');
  39:                 }
  40:             } catch {
  ...
  44:         return candidate;
  ```
  If `.vertex` does not exist as a directory, `getContextFile()` returns the path `baseRoot/.vertex`. Then, `init()` checks `if (!fs.existsSync(contextFile))` and executes:
  ```typescript
  50:             fs.mkdirSync(path.dirname(contextFile), { recursive: true });
  51:             fs.writeFileSync(contextFile, JSON.stringify({}, null, 2));
  ```
  * **Resulting Issue:** This writes the JSON state object into a file named `.vertex` at the workspace root, creating a **file** instead of a **directory**. This blocks any subsequent creation of a `.vertex/` directory. Consequently:
    1. Configuration files (like `scope.json`) fallback to `.vertex_plugins/scope.json` instead of `.vertex/scope.json`.
    2. Any tools or scripts expecting a `.vertex` folder will crash or write files to wrong paths.
  * **Fix Strategy:** Modify `getContextFile` to always return `path.join(baseRoot, '.vertex', 'state.json')`. The `fs.mkdirSync` on the parent directory will then correctly create the `.vertex` directory.

---

### Finding 2.2: Command Injection Vulnerabilities in System Tools
* **File Path:** `src/tools/LinuxSecurity.ts`, `src/tools/System.ts`, `src/tools/OffensiveTools.ts`
* **Observation:**
  Several tools pass unsanitized user inputs to `child_process.exec` (which runs commands inside a shell context):
  1. **`dns_lookup` (`LinuxSecurity.ts`):**
     ```typescript
     50:         let result = await shell(`nslookup -type=${type} ${host}`);
     ```
     `host` (`args.hostname`) is unvalidated. Entering `google.com & calc.exe` executes arbitrary code.
  2. **`port_scan` (`LinuxSecurity.ts`):**
     ```typescript
     89:         const nmapResult = await shell(`nmap -p ${portsArg} --open -T4 ${host}`, 60_000);
     ```
     `host` and `portsArg` are interpolated directly into nmap commands without verification.
  3. **`process_manager` (`System.ts`):**
     ```typescript
     37:                     cmd = isPid ? `taskkill /F /PID ${args.target}` : `taskkill /F /IM ${args.target}`;
     39:                     cmd = `kill -9 ${args.target}`;
     ```
     `args.target` is not sanitized. On Linux, a target of `1234; calc.exe` executes the payload.
  4. **`msf_execute` & `sliver_execute` (`OffensiveTools.ts`):**
     ```typescript
     91:         const escaped = args.command.replace(/"/g, '\\"');
     92:         const cmd = `"${msfPath}" -qx "${escaped}"`;
     ```
     Escaping quotes with `\\"` is a Linux convention. In Windows `cmd.exe`, backslash does not escape double quotes, allowing command separation via characters like `&` after breaking out of quotes.
  5. **`cme_execute` (`OffensiveTools.ts`):**
     ```typescript
     402:         if (args.username) parts.push(`-u "${args.username}"`);
     ```
     Inserts arguments into double quotes with **no escaping**, making it trivial to inject commands via quotes (e.g. `username = 'admin" & whoami'`).
  * **Fix Strategy:** Use `child_process.spawn` or `execFile` with an array of arguments to bypass shell expansion entirely. Alternatively, enforce strict validation regex rules (e.g., ensuring `hostname` matches domain regex, `target` processes contain no shell metacharacters).

---

### Finding 2.3: `BrowserAgent` Stateless Browser Session Lifecycle
* **File Path:** `src/agents/BrowserAgent.ts`
* **Line Range:** 235-237, 257-259, 290-292, 351-353
* **Observation:**
  Every page action calls `await this.closeBrowser()` in its `finally` block:
  ```typescript
  228:     public async navigateUrl(url: string): Promise<string> {
  229:         try {
  ...
  235:         } finally {
  236:             await this.closeBrowser();
  237:         }
  ```
  * **Resulting Issue:** Since the browser is closed after every single tool execution, the session is completely stateless. If the agent runs `browser_navigate` to open a login page, and then calls `browser_get_content` to inspect the page text, a brand new browser is created pointing to `about:blank`. Cross-tool browsing workflows are impossible.
  * **Fix Strategy:** Keep the browser session open across tool calls. Remove the `finally` block closures. Instead, implement a shutdown hook or let the parent agent close the browser session on task termination.

---

### Finding 2.4: Terminal is Not Cleared on `/clear` Command
* **File Path:** `src/ui.tsx`
* **Line Range:** 195-200
* **Observation:**
  ```tsx
  195:     if (lowerQuery === '/clear' || lowerQuery === 'clear') {
  196:       setPromptValue('');
  197:       setHistory([]);
  198:       orchestrator.clearHistory();
  199:       return;
  200:     }
  ```
  * **Resulting Issue:** Running `/clear` clears React state, but does not clear the terminal console scrollback. The previous output remains printed on the screen.
  * **Fix Strategy:** Execute `console.clear()` or `process.stdout.write('\x1Bc')` inside the `/clear` command block.

---

### Finding 2.5: Keyboard Input Processing Blocked During Streaming
* **File Path:** `src/ui.tsx`
* **Line Range:** 373-375
* **Observation:**
  ```tsx
  373:     if (isStreaming) {
  374:       return;
  375:     }
  ```
  * **Resulting Issue:** When the agent is streaming a response or running a long background task, all keypress handling in `useInput` returns early. This blocks standard CLI key interceptions, making custom cancellation shortcuts impossible to catch at this level.
  * **Fix Strategy:** Intercept specific hotkeys (like custom abort keys or terminal exits) prior to the `isStreaming` block check.

---

### Finding 2.6: Tool Name Discrepancy in `CyberAgent` description
* **File Path:** `src/agents/CyberAgent.ts`
* **Line Range:** 40
* **Observation:**
  ```typescript
  40: - list_dir: Enumerate directory structures for attack surface mapping.
  ```
  The description specifies `list_dir`, but the actual tool name registered is `list_directory`.
  * **Resulting Issue:** The model may try to call the non-existent `list_dir` tool, causing execution failures.
  * **Fix Strategy:** Rename the tool description in `CyberAgent.ts` to `- list_directory`.

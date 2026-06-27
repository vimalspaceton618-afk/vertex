import React, { useState, useRef, useEffect } from 'react';

const Spinner = () => {
    const frames = ['·', '✦', '★', '✦'];
    const [frame, setFrame] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setFrame((current) => (current + 1) % frames.length);
        }, 150);
        return () => clearInterval(timer);
    }, []);

    return <Text color="magentaBright"> {frames[frame]} </Text>;
};
import { Box, Text, useInput, useApp } from 'ink';
import { AgentManager } from './core/agent/AgentManager.js';
import { collectHealthStatus, formatHealthReport } from './core/health.js';
import { describeScope, ensureScopeFile } from './core/policy/PolicyEngine.js';
import { SafetyResearchSandboxTool } from './tools/DockerSandbox.js';

ensureScopeFile();

const App = () => {
  const { exit } = useApp();
  const [isTrusted, setIsTrusted] = useState(false);
  const [trustCursor, setTrustCursor] = useState(1);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{role: string, content: string}[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [confirmPrompt, setConfirmPrompt] = useState<{message: string, resolve: (val: boolean) => void} | null>(null);
  
  const orchestrator = useRef(new AgentManager()).current;

  useInput((char, key) => {
    if (!isTrusted) {
      if (char === '1' || (key.return && trustCursor === 1)) {
        process.env.VERTEX_WORKSPACE_ROOT = process.cwd();
        setIsTrusted(true);
      } else if (char === '2' || (key.return && trustCursor === 2) || key.escape) {
        exit();
      } else if (key.upArrow) {
        setTrustCursor(1);
      } else if (key.downArrow) {
        setTrustCursor(2);
      }
      return;
    }

    // If we are showing a confirmation prompt, intercept keys for Y/N only
    if (confirmPrompt) {
      const lower = char?.toLowerCase();
      if (lower === 'y') {
        confirmPrompt.resolve(true);
        setConfirmPrompt(null);
      } else if (lower === 'n') {
        confirmPrompt.resolve(false);
        setConfirmPrompt(null);
      } else if (key.return) {
        confirmPrompt.resolve(true);
        setConfirmPrompt(null);
      }
      return; // exit early
    }

    if (key.return && !isStreaming) {
      if (input.trim().length > 0) {
        const query = input.trim();
        
        // Intercept local commands
        const lowerQuery = query.toLowerCase();
        if (lowerQuery === 'exit' || lowerQuery === 'quit' || lowerQuery === '/exit' || lowerQuery === '/quit') {
            exit();
            return;
        }

        if (lowerQuery === 'help' || lowerQuery === '/help') {
            setInput('');
            const helpText = "VERTEX Cybersecurity CLI — Commands\n" +
              "════════════════════════════════════════════\n" +
              "General Commands:\n" +
              "  /help                  - Show this help message\n" +
              "  /health                - Show runtime readiness checks\n" +
              "  /scope show            - Show engagement scope and tool policy\n" +
              "  /plugins               - List loaded plugin catalog\n" +
              "  /dashboard             - Toggle live system monitoring\n" +
              "  /exit                  - Quit the application\n\n" +
              "🌐 Browser Commands:\n" +
              "  /search <query>        - Search DuckDuckGo through BrowserAgent\n\n" +
              "🔐 Security & Sandbox Commands:\n" +
              "  /sandbox <cmd>         - Run a command in an isolated Docker container\n" +
              "                           (no network, memory-capped, capability-dropped)\n" +
              "  /safe-sandbox <cmd>    - Hardened safety-research sandbox\n" +
              "                           (Docker required, no fallback, read-only rootfs)\n" +
              "  /audit [path]          - Run a full security audit on a directory\n" +
              "                           (checks open ports, secrets, file integrity,\n" +
              "                            active connections, and running processes)\n\n" +
              "⚔️  Offensive Operations (Nyx Arsenal):\n" +
              "  /nyx <prompt>          - Route directly to NyxAgent for offensive ops\n" +
              "                           (Metasploit, Nmap NSE, Burp, CME, Sliver)\n\n" +
              "Agents Available:\n" +
              "  ExploreAgent   : Research and file exploration\n" +
              "  PlanAgent      : Task planning and decomposition\n" +
              "  DeveloperAgent : Code writing and system modification\n" +
              "  QualityAgent   : Testing, linting, and validation\n" +
              "  DevOpsAgent    : Deployment and infrastructure\n" +
              "  BrowserAgent   : Web interaction and scraping\n" +
              "  NetworkAgent   : External API orchestration\n" +
              "  🛡️ CyberAgent   : Security audits · Sandboxed execution · Port scanning\n" +
              "                   DNS investigation · File integrity · Secrets detection\n" +
              "  ⚔️  NyxAgent     : Metasploit · Nmap NSE · Burp Suite · CrackMapExec\n" +
              "                   Sliver C2 · Offensive operations · Red team ops\n\n" +
              "Examples:\n" +
              "  /sandbox nmap -sV localhost\n" +
              "  /safe-sandbox cat /etc/os-release\n" +
              "  /safe-sandbox --image python:3.12-alpine python -c \"print(2+2)\"\n" +
              "  /search kali linux nmap nse scripts\n" +
              "  /audit .\n" +
              "  /audit C:\\Users\\ADMIN\\project\n" +
              "  /nyx scan 192.168.1.0/24 with service detection and vuln scripts\n" +
              "  /nyx spray creds admin:Password1 over SMB on 10.0.0.0/24\n" +
              "  Audit my running services for suspicious connections\n" +
              "  Scan port 22 and 443 on 192.168.1.1\n" +
              "  Check for leaked API keys in this directory";
            setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: helpText }]);
            return;
        }

        if (lowerQuery === '/health') {
            setInput('');
            const status = collectHealthStatus();
            setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: formatHealthReport(status) }]);
            return;
        }

        if (lowerQuery === '/scope' || lowerQuery === '/scope show') {
            setInput('');
            setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: describeScope() }]);
            return;
        }

        if (lowerQuery === '/plugins') {
            setInput('');
            setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: 'Run: "list all plugins and categories" to invoke the plugin catalog via AgentManager.' }]);
            return;
        }

        if (lowerQuery === '/dashboard') {
            setInput('');
            setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: 'Dashboard feature is currently under development.' }]);
            return;
        }

        // /search <query> — route DuckDuckGo search through BrowserAgent
        if (lowerQuery.startsWith('/search ')) {
            const searchQuery = query.slice('/search '.length).trim();
            if (!searchQuery) {
                setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: 'Usage: /search <query>\nExample: /search kali linux nmap nse scripts' }]);
                setInput('');
                return;
            }
            setInput('');
            setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: '' }]);
            setIsStreaming(true);
            const runSearch = async () => {
                const askConfirm = (msg: string) =>
                    new Promise<boolean>((resolve) => {
                        setConfirmPrompt({ message: msg, resolve: (val) => { console.clear(); resolve(val); } });
                    });
                const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
                const prompt = [
                    `Use browser_get_content to open this DuckDuckGo search URL: ${url}`,
                    `Search query: ${searchQuery}`,
                    'Return the most relevant visible results with titles, snippets, and URLs when present.',
                    'Keep the answer concise and mention if the browser runtime is not configured.'
                ].join('\n');
                const stream = orchestrator.delegateTask(
                    `[ROUTE_DIRECT:BrowserAgent] ${prompt}`,
                    askConfirm
                );
                let fullText = '';
                for await (const chunk of stream) {
                    fullText += chunk;
                    setHistory(prev => {
                        const updated = [...prev];
                        updated[updated.length - 1] = { role: 'assistant', content: fullText };
                        return updated;
                    });
                }
                orchestrator.recordTurn(query, fullText);
                setIsStreaming(false);
            };
            runSearch();
            return;
        }

        // /sandbox <command> — isolate and execute in Docker
        if (lowerQuery.startsWith('/safe-sandbox ')) {
            const raw = query.slice('/safe-sandbox '.length).trim();
            const imageMatch = raw.match(/^--image\s+(\S+)\s+([\s\S]+)$/);
            const image = imageMatch?.[1];
            const command = (imageMatch?.[2] || raw).trim();
            if (!command) {
                setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: 'Usage: /safe-sandbox [--image alpine:latest|python:3.12-alpine|node:22-alpine] <command>' }]);
                setInput('');
                return;
            }
            setInput('');
            setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: '' }]);
            setIsStreaming(true);
            const runSafeSandbox = async () => {
                const askConfirm = (msg: string) =>
                    new Promise<boolean>((resolve) => {
                        setConfirmPrompt({ message: msg, resolve: (val) => { console.clear(); resolve(val); } });
                    });
                const result = await new SafetyResearchSandboxTool().execute({ command, image }, askConfirm);
                setHistory(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { role: 'assistant', content: result };
                    return updated;
                });
                orchestrator.recordTurn(query, result);
                setIsStreaming(false);
            };
            runSafeSandbox();
            return;
        }

        // /sandbox <command> — isolate and execute in Docker
        if (lowerQuery.startsWith('/sandbox ')) {
            const sandboxCmd = query.slice('/sandbox '.length).trim();
            if (!sandboxCmd) {
                setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: 'Usage: /sandbox <shell command>\nExample: /sandbox ls -la' }]);
                setInput('');
                return;
            }
            setInput('');
            setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: '' }]);
            setIsStreaming(true);
            const runSandbox = async () => {
                const askConfirm = (msg: string) =>
                    new Promise<boolean>((resolve) => {
                        setConfirmPrompt({ message: msg, resolve: (val) => { console.clear(); resolve(val); } });
                    });
                const prompt = `Use the sandbox_execute tool to run the following command in an isolated Docker container and return the output. Command: ${sandboxCmd}`;
                const stream = orchestrator.delegateTask(
                    `[ROUTE_DIRECT:CyberAgent] ${prompt}`,
                    askConfirm
                );
                let fullText = '';
                for await (const chunk of stream) {
                    fullText += chunk;
                    setHistory(prev => {
                        const updated = [...prev];
                        updated[updated.length - 1] = { role: 'assistant', content: fullText };
                        return updated;
                    });
                }
                orchestrator.recordTurn(query, fullText);
                setIsStreaming(false);
            };
            runSandbox();
            return;
        }

        // /audit [path] — trigger CyberAgent full security audit
        if (lowerQuery.startsWith('/audit')) {
            const auditPath = query.slice('/audit'.length).trim() || process.cwd();
            setInput('');
            setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: '' }]);
            setIsStreaming(true);
            const runAudit = async () => {
                const askConfirm = (msg: string) =>
                    new Promise<boolean>((resolve) => {
                        setConfirmPrompt({ message: msg, resolve: (val) => { console.clear(); resolve(val); } });
                    });
                const prompt = [
                    `Perform a comprehensive security audit on this path: ${auditPath}`,
                    'Run the following checks in sequence:',
                    '1. Scan for exposed secrets using env_secrets_scan',
                    '2. Run file_integrity on the target path',
                    '3. Run network_audit to inspect active connections',
                    '4. Run process_inspect to list suspicious processes',
                    '5. Compile a structured EXECUTIVE SUMMARY with a FINDINGS TABLE and RECOMMENDATIONS.'
                ].join('\n');
                const stream = orchestrator.delegateTask(
                    `[ROUTE_DIRECT:CyberAgent] ${prompt}`,
                    askConfirm
                );
                let fullText = '';
                for await (const chunk of stream) {
                    fullText += chunk;
                    setHistory(prev => {
                        const updated = [...prev];
                        updated[updated.length - 1] = { role: 'assistant', content: fullText };
                        return updated;
                    });
                }
                orchestrator.recordTurn(query, fullText);
                setIsStreaming(false);
            };
            runAudit();
            return;
        }

        // /nyx <prompt> — route directly to NyxAgent for offensive operations
        if (lowerQuery.startsWith('/nyx ')) {
            const nyxPrompt = query.slice('/nyx '.length).trim();
            if (!nyxPrompt) {
                setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: 'Usage: /nyx <offensive security prompt>\nExample: /nyx scan 192.168.1.0/24 with nmap service detection and vuln scripts' }]);
                setInput('');
                return;
            }
            setInput('');
            setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: '' }]);
            setIsStreaming(true);
            const runNyx = async () => {
                const askConfirm = (msg: string) =>
                    new Promise<boolean>((resolve) => {
                        setConfirmPrompt({ message: msg, resolve: (val) => { console.clear(); resolve(val); } });
                    });
                const stream = orchestrator.delegateTask(
                    `[ROUTE_DIRECT:NyxAgent] ${nyxPrompt}`,
                    askConfirm
                );
                let fullText = '';
                for await (const chunk of stream) {
                    fullText += chunk;
                    setHistory(prev => {
                        const updated = [...prev];
                        updated[updated.length - 1] = { role: 'assistant', content: fullText };
                        return updated;
                    });
                }
                orchestrator.recordTurn(query, fullText);
                setIsStreaming(false);
            };
            runNyx();
            return;
        }

        setInput('');
        setHistory(prev => [...prev, { role: 'user', content: query }, { role: 'assistant', content: '' }]);
        setIsStreaming(true);

        const runStream = async () => {
             const askConfirm = (msg: string) => {
                 return new Promise<boolean>((resolve) => {
                     setConfirmPrompt({ message: msg, resolve: (val) => { console.clear(); resolve(val); } });
                 });
             };

             const stream = orchestrator.delegateTask(query, askConfirm);
             let fullText = "";
             for await (const chunk of stream) {
                 fullText += chunk;
                 setHistory(prev => {
                     const updated = [...prev];
                     updated[updated.length - 1] = { role: 'assistant', content: fullText };
                     return updated;
                 });
             }
             orchestrator.recordTurn(query, fullText);
             setIsStreaming(false);
        };
        runStream();
      }
    } else if (key.backspace || key.delete) {
      if (!isStreaming) setInput((prev) => prev.slice(0, -1));
    } else {
      if (!isStreaming && char && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.ctrl && !key.meta) {
        setInput((prev) => prev + char);
      }
    }
  });

  if (!isTrusted) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="yellowBright" bold>Accessing workspace:</Text>
        <Box marginY={1}>
          <Text>{process.cwd()}</Text>
        </Box>
        <Text>Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source</Text>
        <Text>project, or work from your team). If not, take a moment to review what's in this folder first.</Text>
        <Box marginY={1}>
          <Text>VERTEX will be able to read, edit, and execute files here.</Text>
        </Box>
        <Text color="gray">Security guide</Text>
        <Box flexDirection="column" marginY={1}>
          <Text color={trustCursor === 1 ? "blueBright" : "white"}>{trustCursor === 1 ? '❯ 1. Yes, I trust this folder' : '  1. Yes, I trust this folder'}</Text>
          <Text color={trustCursor === 2 ? "blueBright" : "white"}>{trustCursor === 2 ? '❯ 2. No, exit' : '  2. No, exit'}</Text>
        </Box>
        <Text color="gray">Enter to confirm · Esc to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={100}>
      <Box marginBottom={1}>
        <Text color="cyanBright" bold>VERTEX System v3.0 </Text>
        <Text color="gray">{'─'.repeat(81)}</Text>
      </Box>

      <Box borderStyle="round" borderColor="gray" paddingX={4} paddingY={2} justifyContent="space-between">
        <Box flexDirection="column" alignItems="center" width="40%">
          <Text bold color="white">Welcome back!</Text>
          <Box marginY={1} flexDirection="column" alignItems="center">
            <Text color="#F13E93">{'    ██████    '}</Text>
            <Text color="#F13E93">{'  ██████████  '}</Text>
            <Text color="#F13E93">{'██████████████'}</Text>
            <Text color="#F13E93">{'██  ██████  ██'}</Text>
            <Text color="#F13E93">{'██████████████'}</Text>
            <Text color="#F13E93">{'  ██      ██  '}</Text>
          </Box>
          <Text color="gray">VERTEX Cybersecurity CLI · 8 Agents · 19 Tools</Text>
          <Text color="gray">E:\VERTEX</Text>
        </Box>

        <Box flexDirection="column" width="55%">
          <Text color="cyanBright" bold>Security Commands</Text>
          <Text color="gray">  /sandbox &lt;cmd&gt;   Run cmd in Docker isolation</Text>
          <Text color="gray">  /safe-sandbox     Hardened safety sandbox</Text>
          <Text color="gray">  /search &lt;query&gt;  Search DuckDuckGo in browser</Text>
          <Text color="gray">  /audit [path]    Full security audit of a directory</Text>
          <Text color="gray">  /health          Check runtime readiness</Text>
          <Text color="gray">  /scope show      Show engagement scope</Text>
          <Text color="gray">  /help            Show all commands and agents</Text>
          <Box marginY={1}></Box>
          <Text color="#F13E93" bold>🛡️  CyberAgent Active</Text>
          <Text color="gray">  Port scanning · Secrets detection · Sandboxing</Text>
          <Text color="gray">  File integrity · Network audit · Process inspection</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1} marginBottom={1} width="100%">
        {history.map((msg, index) => (
          <Box 
            key={index} 
            flexDirection="column" 
            marginBottom={1}
            paddingX={2}
            paddingY={1}
            borderStyle="round"
            borderColor={msg.role === 'user' ? 'green' : 'cyan'}
            alignSelf={msg.role === 'user' ? 'flex-end' : 'flex-start'}
            width="80%"
          >
            <Text color={msg.role === 'user' ? 'greenBright' : 'cyanBright'} bold>
              {msg.role === 'user' ? 'User' : 'VERTEX'}
            </Text>
            <Text>{msg.content}</Text>
          </Box>
        ))}
      </Box>

      {confirmPrompt && (
        <Box borderStyle="bold" borderColor="yellow" padding={1} flexDirection="column" marginY={1}>
          <Text color="yellowBright" bold>⚡ SECURE APPROVAL REQUIRED ⚡</Text>
          <Text>{confirmPrompt.message}</Text>
        </Box>
      )}

      {!confirmPrompt && (
        <Box marginTop={1} paddingX={2} paddingY={1} borderStyle="round" borderColor="magenta">
          <Text color="cyanBright" bold>vertex&gt; </Text>
          <Text>{input}</Text>
          {isStreaming ? <Spinner /> : <Text color="gray">{'|'}</Text>}
        </Box>
      )}
    </Box>
  );
};

export default App;

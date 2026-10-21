import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { ToolRegistry } from '../../tools/registry.js';
import { Message } from '../llm.js';
import { getPluginManager } from '../../plugins/index.js';

dotenv.config();

function resolveModelForAgent(agentName: string): string {
    if (agentName === 'PlanAgent' || agentName === 'ExploreAgent') {
        return process.env.AI_MODEL_PLAN || process.env.AI_MODEL_FAST || process.env.AI_MODEL || 'gpt-4o';
    }
    if (agentName === 'DeveloperAgent') {
        return process.env.AI_MODEL_CODE || process.env.AI_MODEL || 'gpt-4o';
    }
    return process.env.AI_MODEL || process.env.AI_MODEL_FAST || 'gpt-4o';
}

type BrainCandidate = {
    provider: 'local' | 'cloud';
    model: string;
    apiKey: string;
    baseURL?: string;
};
type BrainProvider = 'local' | 'cloud';

function formatProviderFailure(candidate: BrainCandidate, error: any): string {
    const message = String(error?.message || 'unknown error');
    const isConnection =
        message.includes('ECONNREFUSED') ||
        message.toLowerCase().includes('connection error') ||
        message.toLowerCase().includes('fetch failed');
    const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate limit');
    if (candidate.provider === 'local' && isConnection) {
        return `[local] Connection error at ${candidate.baseURL}. Start local server (e.g., Ollama: "ollama serve") and ensure model "${candidate.model}" is available.`;
    }
    if (candidate.provider === 'cloud' && isRateLimit) {
        return `[cloud] Rate limit exceeded for model "${candidate.model}".`;
    }
    return `[${candidate.provider}] ${message}`;
}

const clientCache = new Map<string, OpenAI>();
function getClientFor(baseURL: string | undefined, apiKey: string): OpenAI {
    const cacheKey = `${baseURL || 'default'}::${apiKey || 'dummy-key'}`;
    const existing = clientCache.get(cacheKey);
    if (existing) return existing;
    const client = new OpenAI({
        apiKey: apiKey || 'dummy-key',
        baseURL
    });
    clientCache.set(cacheKey, client);
    return client;
}

function resolveLocalModelForAgent(agentName: string): string {
    if (agentName === 'PlanAgent' || agentName === 'ExploreAgent') {
        return process.env.LOCAL_MODEL_PLAN || process.env.LOCAL_MODEL_FAST || process.env.LOCAL_MODEL || resolveModelForAgent(agentName);
    }
    if (agentName === 'DeveloperAgent') {
        return process.env.LOCAL_MODEL_CODE || process.env.LOCAL_MODEL || resolveModelForAgent(agentName);
    }
    return process.env.LOCAL_MODEL || process.env.LOCAL_MODEL_FAST || resolveModelForAgent(agentName);
}

function getBrainCandidates(agentName: string): BrainCandidate[] {
    const mode = (process.env.BRAIN_MODE || 'cloud').toLowerCase();
    const cloud: BrainCandidate = {
        provider: 'cloud',
        model: resolveModelForAgent(agentName),
        apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
        baseURL: process.env.OPENAI_BASE_URL
    };
    const local: BrainCandidate = {
        provider: 'local',
        model: resolveLocalModelForAgent(agentName),
        apiKey: process.env.LOCAL_API_KEY || 'local-key',
        baseURL: process.env.LOCAL_BASE_URL || 'http://127.0.0.1:11434/v1'
    };
    const providerMap: Record<BrainProvider, BrainCandidate> = { local, cloud };
    const rawRoutingMap = process.env.BRAIN_ROUTING_MAP?.trim();
    if (rawRoutingMap) {
        try {
            const parsed = JSON.parse(rawRoutingMap) as Record<string, BrainProvider[]>;
            const route = parsed[agentName] || parsed['*'];
            if (Array.isArray(route) && route.length > 0) {
                const normalized = route.filter((x) => x === 'local' || x === 'cloud');
                if (normalized.length > 0) {
                    const deduped = Array.from(new Set(normalized));
                    return deduped.map((provider) => providerMap[provider]);
                }
            }
        } catch {
            // Ignore malformed routing map and fall back to mode defaults
        }
    }
    if (mode === 'local') return [local, cloud];
    if (mode === 'hybrid') {
        if (agentName === 'PlanAgent' || agentName === 'ExploreAgent') {
            return [local, cloud];
        }
        if (agentName === 'DeveloperAgent') {
            return [cloud, local];
        }
        if (agentName === 'BrowserAgent' || agentName === 'DevOpsAgent') {
            return [cloud, local];
        }
        return [local, cloud];
    }
    return [cloud, local];
}

/**
 * Wait for a retry window without keeping cancelled work asleep.
 * Returns false when the caller's signal aborts before the delay finishes.
 */
export function waitForRetryDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve(false);
            return;
        }

        let settled = false;
        let timer: ReturnType<typeof setTimeout>;
        const onAbort = () => finish(false);
        const finish = (completed: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve(completed);
        };

        timer = setTimeout(() => finish(true), ms);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) finish(false);
    });
}

/**
 * Let the orchestration loop stop waiting when a task is cancelled.
 * The underlying operation still needs to honor the same signal to stop its own work.
 */
export function awaitWithAbort<T>(operation: PromiseLike<T> | T, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('Operation aborted.'));
            return;
        }

        let settled = false;
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        const onAbort = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('Operation aborted.'));
        };

        signal?.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(operation).then(
            (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            },
            (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            }
        );
        if (signal?.aborted) onAbort();
    });
}

export abstract class BaseAgent {
    protected history: Message[] = [];
    protected registry = new ToolRegistry();
    public name: string;
    
    constructor(name: string, systemPrompt: string) {
        this.name = name;
        this.history.push({
            role: 'system',
            content: systemPrompt
        });
        this.setupTools();
        getPluginManager().registerToolsForAgent(this.name, this.registry);
    }

    protected abstract setupTools(): void;

    public clearHistory(): void {
        const systemPrompt = this.history.find(m => m.role === 'system')?.content || '';
        this.history = [];
        if (systemPrompt) {
            this.history.push({ role: 'system', content: systemPrompt });
        }
    }

    public async *run(input: string, requestConfirmation: (msg: string) => Promise<boolean>, signal?: AbortSignal): AsyncGenerator<string> {
        this.history.push({ role: 'user', content: input });

        let keepRunning = true;
        const startedAt = Date.now();
        const isAutonomous = process.env.AUTONOMOUS_MODE === 'true' || process.env.VERTEX_AUTONOMOUS === '1';
        const defaultIterations = isAutonomous ? 50 : 25;
        const defaultDurationMs = isAutonomous ? 30 * 60 * 1000 : 10 * 60 * 1000;

        const maxIterations = Math.max(1, Math.min(Number(process.env.AUTO_LOOP_MAX_ITERATIONS || defaultIterations), 100));
        const maxDurationMs = Math.max(1000, Math.min(Number(process.env.AUTO_LOOP_MAX_DURATION_MS || defaultDurationMs), 60 * 60 * 1000));
        let iteration = 0;
        
        while (keepRunning) {
            if (signal?.aborted) {
                yield `\n[INTERRUPTED BY ESC]`;
                break;
            }
            iteration += 1;
            const elapsed = Date.now() - startedAt;
            if (iteration > maxIterations) {
                const budgetMsg = `\n[${this.name} LOOP STOP]: Iteration budget exceeded (${maxIterations}).`;
                yield budgetMsg;
                this.history.push({ role: 'assistant', content: budgetMsg });
                break;
            }
            if (elapsed > maxDurationMs) {
                const budgetMsg = `\n[${this.name} LOOP STOP]: Time budget exceeded (${maxDurationMs}ms).`;
                yield budgetMsg;
                this.history.push({ role: 'assistant', content: budgetMsg });
                break;
            }
            let currentResponse = "";
            let currentToolCalls: Record<number, any> = {};
            let streamSuccess = false;
            let retryAttempt = 0;
            const MAX_RETRIES = 15;

            while (!streamSuccess && retryAttempt < MAX_RETRIES) {
                if (signal?.aborted) break;
                try {
                    const toolsConfig = this.registry.getToolsSchema().length > 0 
                      ? { tools: this.registry.getToolsSchema() as any } 
                      : {};

                    const candidates = getBrainCandidates(this.name);
                    let stream: Awaited<ReturnType<OpenAI['chat']['completions']['create']>> | null = null;
                    const providerErrors: string[] = [];
                    let activeProviderLabel = '';
                    for (const candidate of candidates) {
                        if (signal?.aborted) break;
                        try {
                            const client = getClientFor(candidate.baseURL, candidate.apiKey);
                            activeProviderLabel = `${candidate.provider}:${candidate.model}`;
                            stream = await client.chat.completions.create({
                                model: candidate.model,
                                messages: this.history as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                                stream: true,
                                max_tokens: process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : undefined,
                                ...toolsConfig
                            }, { signal });
                            break;
                        } catch (providerError: any) {
                            const formatted = formatProviderFailure(candidate, providerError);
                            providerErrors.push(formatted);
                            if (retryAttempt === 0) yield `\n[${this.name} BRAIN FALLBACK]: ${formatted}`;
                        }
                    }
                    if (signal?.aborted) break;
                    if (!stream) {
                        const guidance =
                            '\nTry: 1) set LOCAL_BASE_URL correctly, 2) run local server, 3) switch BRAIN_MODE to local/hybrid, 4) update cloud model/key/quota.';
                        throw new Error(`All brain providers failed.\n${providerErrors.join('\n')}${guidance}`);
                    }
                    
                    if (retryAttempt === 0) yield `\n[${this.name} BRAIN ROUTE]: ${activeProviderLabel}\n`;

                    for await (const chunk of stream) {
                        if (signal?.aborted) break;
                        const delta = chunk.choices[0]?.delta;
                        
                        if (delta?.content) {
                            currentResponse += delta.content;
                            yield delta.content;
                        }
                        
                        if (delta?.tool_calls) {
                            for (const toolCall of delta.tool_calls) {
                                const index = toolCall.index;
                                if (!currentToolCalls[index]) {
                                    currentToolCalls[index] = { id: toolCall.id, type: 'function', function: { name: toolCall.function?.name, arguments: '' }};
                                }
                                if (toolCall.function?.arguments) {
                                    currentToolCalls[index].function.arguments += toolCall.function.arguments;
                                }
                            }
                        }
                    }

                    streamSuccess = true;
                } catch (error: any) {
                    if (signal?.aborted) break;
                    const message = error.message || '';
                    const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate limit') || message.toLowerCase().includes('resourceexhausted');
                    
                    if (isRateLimit && retryAttempt < MAX_RETRIES - 1) {
                        retryAttempt++;
                        const backoffMs = Math.min(2000 * Math.pow(1.5, retryAttempt), 30000);
                        yield `\n[RATE LIMIT HIT]: Retrying in ${Math.round(backoffMs/1000)}s (Attempt ${retryAttempt}/${MAX_RETRIES})...\n`;
                        const delayCompleted = await waitForRetryDelay(backoffMs, signal);
                        if (!delayCompleted || signal?.aborted) break;
                        currentResponse = "";
                        currentToolCalls = {};
                    } else {
                        const errorMessage = `\n[${this.name} SYSTEM ERROR]: ${error.message}`;
                        yield errorMessage;
                        this.history.push({ role: 'assistant', content: errorMessage });
                        keepRunning = false;
                        break;
                    }
                }
            }

            if (signal?.aborted) {
                yield `\n[INTERRUPTED BY ESC]`;
                break;
            }

            if (!keepRunning) continue;

            const toolCallsArray = Object.values(currentToolCalls);
            
            if (toolCallsArray.length > 0) {
                this.history.push({ role: 'assistant', content: currentResponse || null, tool_calls: toolCallsArray });
                
                if (toolCallsArray.length > 1) {
                    yield `\n\n[${this.name} PARALLEL TOOLS]: Executing ${toolCallsArray.length} tools concurrently...`;
                    
                    const toolExecPromises = toolCallsArray.map(async (toolCall) => {
                        const toolName = toolCall.function.name;
                        const tool = this.registry.getTool(toolName);
                        if (!tool) {
                            return { id: toolCall.id, name: toolName, resultStr: `[ERROR]: Tool ${toolName} not found.` };
                        }
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            const executionResult = await awaitWithAbort(tool.execute(args, requestConfirmation, signal), signal);
                            let resultStr = '';
                            if (executionResult && typeof (executionResult as any)[Symbol.asyncIterator] === 'function') {
                                for await (const chunk of executionResult as any) {
                                    if (signal?.aborted) break;
                                    resultStr += chunk;
                                }
                            } else {
                                resultStr = executionResult as string;
                            }
                            return { id: toolCall.id, name: toolName, resultStr };
                        } catch (e: any) {
                            return { id: toolCall.id, name: toolName, resultStr: `[TOOL PARSE OR EXECUTION ERROR]: ${e.message}` };
                        }
                    });

                    const results = await Promise.allSettled(toolExecPromises);
                    if (signal?.aborted) break;
                    for (const res of results) {
                        if (signal?.aborted) break;
                        if (res.status === 'fulfilled') {
                            const { id, name, resultStr } = res.value;
                            this.history.push({ role: 'tool', tool_call_id: id, name, content: resultStr });
                            yield `\n[${this.name} TOOL RESULT (${name})]: ${resultStr.substring(0, 100)}...\n`;
                        }
                    }
                } else {
                    const toolCall = toolCallsArray[0];
                    const toolName = toolCall.function.name;
                    const tool = this.registry.getTool(toolName);
                    
                    yield `\n\n[${this.name} TOOL]: Executing ${toolName}...`;
                    
                    let resultStr = "";
                    if (tool) {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            const executionResult = await awaitWithAbort(tool.execute(args, requestConfirmation, signal), signal);
                            if (signal?.aborted) break;
                            if (executionResult && typeof (executionResult as any)[Symbol.asyncIterator] === 'function') {
                                for await (const chunk of executionResult as any) {
                                    if (signal?.aborted) break;
                                    yield chunk;
                                    resultStr += chunk;
                                }
                            } else {
                                resultStr = executionResult as string;
                            }
                        } catch (e: any) {
                            resultStr = `[TOOL PARSE OR EXECUTION ERROR]: ${e.message}`;
                        }
                        if (signal?.aborted) break;
                    } else {
                        resultStr = `[ERROR]: Tool ${toolName} not found.`;
                    }
                    
                    this.history.push({ role: 'tool', tool_call_id: toolCall.id, name: toolName, content: resultStr });
                    yield `\n[${this.name} TOOL RESULT]: ${resultStr.substring(0, 100)}...\n`;
                }
            } else {
                this.history.push({ role: 'assistant', content: currentResponse });
                keepRunning = false;
            }
        }
    }
}

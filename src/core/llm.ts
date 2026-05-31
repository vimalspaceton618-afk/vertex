import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { ToolRegistry } from '../tools/registry.js';
dotenv.config();

let clientInstance: OpenAI | null = null;
export function getClient(): OpenAI {
  if (!clientInstance) {
    clientInstance = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "dummy-key",
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }
  return clientInstance;
}

export type Message = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}

export class Orchestrator {
    private history: Message[] = [];
    private registry = new ToolRegistry();
    
    constructor() {
        this.history.push({
            role: 'system',
            content: "You are VERTEX, a high-performance cybersecurity agent OS terminal interface. You have tools at your disposal to interact with the host system. When running terminal commands, ask for permission."
        });
    }

    public async *sendMessageStream(userInput: string, requestConfirmation: (msg: string) => Promise<boolean>): AsyncGenerator<string> {
        this.history.push({ role: 'user', content: userInput });

        let keepRunning = true;
        
        while (keepRunning) {
            let currentResponse = "";
            let currentToolCalls: Record<number, any> = {};

            try {
                const stream = await getClient().chat.completions.create({
                    model: process.env.AI_MODEL || 'gpt-4o',
                    messages: this.history as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                    stream: true,
                    tools: this.registry.getToolsSchema() as any
                });

                for await (const chunk of stream) {
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

                const toolCallsArray = Object.values(currentToolCalls);
                
                if (toolCallsArray.length > 0) {
                    this.history.push({ role: 'assistant', content: currentResponse || null, tool_calls: toolCallsArray });
                    
                    for (const toolCall of toolCallsArray) {
                        const tool = this.registry.getTool(toolCall.function.name);
                        
                        yield `\n\n[EXECUTING TOOL]: ${toolCall.function.name}...`;
                        
                        let resultStr = "";
                        if (tool) {
                            try {
                                const args = JSON.parse(toolCall.function.arguments);
                                const executionResult = await tool.execute(args, requestConfirmation);
                                if (executionResult && typeof (executionResult as any)[Symbol.asyncIterator] === 'function') {
                                    for await (const chunk of executionResult as any) {
                                        yield chunk;
                                        resultStr += chunk;
                                    }
                                } else {
                                    resultStr = executionResult as string;
                                }
                            } catch (e: any) {
                                resultStr = `[TOOL PARSE OR EXECUTION ERROR]: ${e.message}`;
                            }
                        } else {
                            resultStr = `[ERROR]: Tool ${toolCall.function.name} not found.`;
                        }
                        
                        this.history.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: resultStr });
                        yield `\n[TOOL RESULT]: ${resultStr.substring(0, 100)}...\n`;
                    }
                    // Loop again with the tool result
                } else {
                    this.history.push({ role: 'assistant', content: currentResponse });
                    keepRunning = false;
                }

            } catch (error: any) {
                const errorMessage = `\n[SYSTEM ERROR]: ${error.message}`;
                yield errorMessage;
                this.history.push({ role: 'assistant', content: errorMessage });
                keepRunning = false;
            }
        }
    }
}

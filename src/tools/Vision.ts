import { Tool } from './Tool.js';
import * as fs from 'fs/promises';
import { constants } from 'node:fs';
import * as path from 'path';
import { resolveInsideWorkspace } from './PathSecurity.js';
import { getClient } from '../core/llm.js';

export class AnalyzeImageTool extends Tool {
    name = "analyze_image";
    description = "Capable of visual perception. Reads an image from the local file system and returns a detailed visual description answering the provided prompt.";
    schema = {
        type: "object",
        properties: {
            imagePath: { type: "string", description: "Absolute path to the image file (png, jpeg, webp, gif)" },
            prompt: { type: "string", description: "What to look for or analyze in the image" }
        },
        required: ["imagePath", "prompt"],
        additionalProperties: false
    };

    async execute(args: { imagePath: string, prompt: string }): Promise<string> {
        try {
            if (typeof args.imagePath !== 'string' || !args.imagePath.trim()) {
                return '[VISION ERROR]: imagePath is required.';
            }
            if (typeof args.prompt !== 'string' || args.prompt.length > 4000) {
                return '[VISION ERROR]: prompt must be a string of at most 4000 characters.';
            }

            // Restrict image reads to the active workspace and reject symlink escapes.
            const safePath = resolveInsideWorkspace(args.imagePath);
            const ext = path.extname(safePath).slice(1).toLowerCase();
            const mimeTypes: Record<string, string> = {
                jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                webp: 'image/webp', gif: 'image/gif'
            };
            const mimeType = mimeTypes[ext];
            if (!mimeType) return '[VISION ERROR]: Only JPG, PNG, WEBP, and GIF images are supported.';

            // Validate and read through the same descriptor to avoid a stat/read race.
            // O_NOFOLLOW is available on POSIX; workspace validation remains the first boundary.
            const noFollow = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW || 0);
            const handle = await fs.open(safePath, constants.O_RDONLY | noFollow);
            let fileBuffer: Buffer;
            try {
                const stat = await handle.stat();
                if (!stat.isFile()) return '[VISION ERROR]: imagePath must refer to a regular file.';
                const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
                if (stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) {
                    return '[VISION ERROR]: Image must be between 1 byte and 20 MiB.';
                }
                fileBuffer = await handle.readFile();
                if (fileBuffer.length <= 0 || fileBuffer.length > MAX_IMAGE_BYTES) {
                    return '[VISION ERROR]: Image must be between 1 byte and 20 MiB.';
                }
            } finally {
                await handle.close();
            }
            
            const base64Image = fileBuffer.toString('base64');
            const dataUrl = `data:${mimeType};base64,${base64Image}`;

            const client = getClient();
            
            // Using gpt-4o as default fallback for vision since many text models don't support it
            const activeModel = process.env.VISION_MODEL || process.env.AI_MODEL || 'gpt-4o';

            const response = await client.chat.completions.create({
                model: activeModel,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: args.prompt },
                            {
                                type: "image_url",
                                image_url: {
                                    url: dataUrl,
                                },
                            },
                        ],
                    },
                ],
                max_tokens: 1000,
            });

            return response.choices[0]?.message?.content || "[VISION API RETURNED NO CONTENT]";
        } catch (error: any) {
            // Check for model compatibility errors smoothly
            if (error.message?.includes("does not support image") || error.message?.includes("vision")) {
                return `[VISION ERROR]: The currently configured AI_MODEL (${process.env.AI_MODEL}) does not support multimodal image input. Please set VISION_MODEL in .env to a vision-capable endpoint (e.g. gpt-4o, claude-3.5-sonnet). Error Details: ${error.message}`;
            }
            return `[VISION ERROR]: ${error.message}`;
        }
    }
}

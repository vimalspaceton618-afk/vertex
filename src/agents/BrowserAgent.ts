import { BaseAgent } from '../core/agent/BaseAgent.js';
import { ReadFileTool, WriteFileTool, ListDirTool } from '../tools/FileSystem.js';
import { AnalyzeImageTool } from '../tools/Vision.js';
import puppeteer, { Browser, Page } from 'puppeteer';
import { Tool } from '../tools/Tool.js';
import { resolveInsideWorkspace } from '../tools/PathSecurity.js';
import * as fs from 'fs';
import * as path from 'path';

function getBrowserCandidates(): string[] {
    const configured = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
    if (configured && fs.existsSync(path.normalize(configured))) {
        return [configured];
    }
    if (process.platform !== 'win32') return [];
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ].filter(Boolean);
    return candidates.filter((p) => fs.existsSync(path.normalize(p)));
}

class BrowserNavigateTool extends Tool {
    name = 'browser_navigate';
    description = 'Navigate browser to URL and return page title.';
    schema = {
        type: 'object',
        properties: { url: { type: 'string', description: 'Target URL to navigate to.' } },
        required: ['url'],
        additionalProperties: false
    };
    constructor(private readonly owner: BrowserAgent) { super(); }
    async execute(args: { url: string }): Promise<string> {
        try {
            const page = await this.owner.ensurePage();
            await page.goto(args.url, { waitUntil: 'domcontentloaded' });
            const title = await page.title();
            return `Navigated to ${args.url}\nTitle: ${title}`;
        } finally {
            await this.owner.closeBrowser();
        }
    }
}

class BrowserScreenshotTool extends Tool {
    name = 'browser_screenshot';
    description = 'Capture screenshot of current page or URL.';
    schema = {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'Path to save screenshot, relative to workspace root.' },
            url: { type: 'string', description: 'Optional URL to visit before screenshot.' }
        },
        required: ['filePath'],
        additionalProperties: false
    };
    constructor(private readonly owner: BrowserAgent) { super(); }
    async execute(args: { filePath: string; url?: string }): Promise<string> {
        try {
            const page = await this.owner.ensurePage();
            if (args.url) {
                await page.goto(args.url, { waitUntil: 'networkidle2' });
            }
            const target = resolveInsideWorkspace(args.filePath);
            await page.screenshot({ path: target, fullPage: true });
            return `Screenshot saved to ${target}`;
        } finally {
            await this.owner.closeBrowser();
        }
    }
}

class BrowserGetContentTool extends Tool {
    name = 'browser_get_content';
    description = 'Extract page text content from current page or URL.';
    schema = {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Optional URL to visit before extraction.' },
            maxChars: { type: 'number', description: 'Maximum chars to return.' }
        },
        additionalProperties: false
    };
    constructor(private readonly owner: BrowserAgent) { super(); }
    async execute(args: { url?: string; maxChars?: number }): Promise<string> {
        try {
            const page = await this.owner.ensurePage();
            if (args.url) {
                await page.goto(args.url, { waitUntil: 'domcontentloaded' });
            }
            const text = await page.evaluate(() => document.body?.innerText || '');
            const maxChars = Math.max(500, Math.min(Number(args.maxChars || 6000), 50000));
            return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
        } finally {
            await this.owner.closeBrowser();
        }
    }
}

export class BrowserAgent extends BaseAgent {
    private browser: Browser | null = null;
    private page: Page | null = null;

    constructor() {
        super(
            "BrowserAgent",
            "You are the Browser Agent. You can visually inspect web apps and take screenshots to verify UI. CRITICAL INSTRUCTION: If you write or generate any code (like HTML/CSS), you MUST use the `write_file` tool to save the code to the file system. DO NOT output massive raw code strings to the chat interface unless specifically asked."
        );
    }

    protected setupTools(): void {
        this.registry.register(new ReadFileTool());
        this.registry.register(new WriteFileTool());
        this.registry.register(new ListDirTool());
        this.registry.register(new AnalyzeImageTool());
        this.registry.register(new BrowserNavigateTool(this));
        this.registry.register(new BrowserScreenshotTool(this));
        this.registry.register(new BrowserGetContentTool(this));
    }

    public async ensurePage(): Promise<Page> {
        if (!this.browser) {
            try {
                const candidates = getBrowserCandidates();
                if (candidates.length > 0) {
                    this.browser = await puppeteer.launch({
                        headless: true,
                        executablePath: candidates[0],
                        args: ['--no-first-run', '--no-default-browser-check']
                    });
                } else {
                    this.browser = await puppeteer.launch({ headless: true });
                }
                // Prevent browser child process from holding headless CLI open.
                this.browser.process()?.unref();
            } catch (error: any) {
                const candidates = getBrowserCandidates();
                const candidateNote = candidates.length
                    ? `Detected browser executable candidates:\n- ${candidates.join('\n- ')}`
                    : 'No browser executable candidates detected. Set PUPPETEER_EXECUTABLE_PATH in ~/.vertexcli/config.json or .env.';
                throw new Error(`Browser launch failed: ${error.message}\n${candidateNote}`);
            }
        }
        if (!this.page) {
            this.page = await this.browser.newPage();
        }
        return this.page;
    }

    public async takeScreenshot(url: string, path: string) {
        const page = await this.ensurePage();
        await page.goto(url);
        await page.screenshot({ path });
    }

    public async closeBrowser() {
        if (this.browser) await this.browser.close();
        this.browser = null;
        this.page = null;
    }
}

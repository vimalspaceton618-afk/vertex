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
    const candidates = process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        ]
        : [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable'
        ];
    return candidates.filter((p) => fs.existsSync(path.normalize(p)));
}

function normalizeHttpUrl(url: string): string {
    const raw = url.trim();
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Only http(s) URLs are supported: ${url}`);
    }
    return parsed.toString();
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripHtml(value: string): string {
    return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' '));
}

async function searchDuckDuckGoLite(query: string, maxResults: number, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new Error('Browser search cancelled.');
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
        },
        signal
    });
    if (!resp.ok) return `[DUCKDUCKGO SEARCH] Lite fallback failed (${resp.status}).`;
    const html = await resp.text();
    const rows = [...html.matchAll(/<a rel="nofollow" href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td class=['"]result-snippet['"]>([\s\S]*?)<\/td>/g)]
        .slice(0, maxResults)
        .map((match, index) => {
            const href = decodeHtmlEntities(match[1]);
            let resultUrl = href;
            try {
                const parsed = new URL(href, 'https://duckduckgo.com');
                const uddg = parsed.searchParams.get('uddg');
                resultUrl = uddg ? decodeURIComponent(uddg) : parsed.href;
            } catch {
                // Keep raw href.
            }
            return {
                rank: index + 1,
                title: stripHtml(match[2]),
                url: resultUrl,
                snippet: stripHtml(match[3])
            };
        })
        .filter((result) => result.title && result.url && !result.url.includes('/y.js?') && !result.snippet.toLowerCase().includes(' ad viewing ads '))
        .map((result, index) => ({ ...result, rank: index + 1 }));

    if (!rows.length) {
        return `[DUCKDUCKGO SEARCH] No results parsed for "${query}".`;
    }

    return [
        `[DUCKDUCKGO SEARCH] ${query}`,
        `Source: DuckDuckGo Lite`,
        `Results: ${rows.length}`,
        '',
        ...rows.map((result) => [
            `${result.rank}. ${result.title}`,
            `   URL: ${result.url}`,
            result.snippet ? `   Snippet: ${result.snippet}` : ''
        ].filter(Boolean).join('\n'))
    ].join('\n');
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
    async execute(args: { url: string }, _requestConfirmation: (msg: string) => Promise<boolean>, signal?: AbortSignal): Promise<string> {
        return this.owner.navigateUrl(args.url, signal);
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
    async execute(args: { filePath: string; url?: string }, _requestConfirmation: (msg: string) => Promise<boolean>, signal?: AbortSignal): Promise<string> {
        return this.owner.screenshotUrl(args.url, args.filePath, signal);
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
    async execute(args: { url?: string; maxChars?: number }, _requestConfirmation: (msg: string) => Promise<boolean>, signal?: AbortSignal): Promise<string> {
        return this.owner.getPageContent(args.url, args.maxChars, signal);
    }
}

class BrowserSearchTool extends Tool {
    name = 'browser_search';
    description = 'Search DuckDuckGo and return structured organic results with title, URL, and snippet.';
    schema = {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query.' },
            maxResults: { type: 'number', description: 'Maximum results to return. Default 8, max 20.' }
        },
        required: ['query'],
        additionalProperties: false
    };
    constructor(private readonly owner: BrowserAgent) { super(); }
    async execute(args: { query: string; maxResults?: number }, _requestConfirmation: (msg: string) => Promise<boolean>, signal?: AbortSignal): Promise<string> {
        return this.owner.searchDuckDuckGo(args.query, args.maxResults, signal);
    }
}

export class BrowserAgent extends BaseAgent {
    private static browser: Browser | null = null;
    private static browserLaunch: Promise<Browser> | null = null;
    private static page: Page | null = null;

    constructor() {
        super(
            "BrowserAgent",
            "You are the Browser Agent. You search, open, inspect, summarize, and screenshot web pages. Use browser_search for search queries, browser_get_content for page text, browser_navigate for opening URLs, and browser_screenshot for screenshots. CRITICAL INSTRUCTION: If you write or generate any code (like HTML/CSS), you MUST use the `write_file` tool to save the code to the file system. DO NOT output massive raw code strings to the chat interface unless specifically asked."
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
        this.registry.register(new BrowserSearchTool(this));
    }

    private async ensureBrowser(): Promise<Browser> {
        if (BrowserAgent.browser && !BrowserAgent.browser.connected) {
            BrowserAgent.browser = null;
            BrowserAgent.browserLaunch = null;
            BrowserAgent.page = null;
        }
        if (!BrowserAgent.browser) {
            if (!BrowserAgent.browserLaunch) {
                BrowserAgent.browserLaunch = (async () => {
                    const candidates = getBrowserCandidates();
                    const options = {
                        headless: true as const,
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check']
                    };
                    try {
                        const browser = candidates.length
                            ? await puppeteer.launch({ ...options, executablePath: candidates[0] })
                            : await puppeteer.launch(options);
                        // Prevent browser child process from holding headless CLI open.
                        browser.process()?.unref();
                        return browser;
                    } catch (error: any) {
                        const candidateNote = candidates.length
                            ? `Detected browser executable candidates:\n- ${candidates.join('\n- ')}`
                            : 'No browser executable candidates detected. Set PUPPETEER_EXECUTABLE_PATH in ~/.vertexcli/config.json or .env.';
                        throw new Error(`Browser launch failed: ${error.message}\n${candidateNote}`);
                    }
                })();
            }
            try {
                BrowserAgent.browser = await BrowserAgent.browserLaunch;
            } finally {
                BrowserAgent.browserLaunch = null;
            }
        }
        return BrowserAgent.browser;
    }

    public async ensurePage(): Promise<Page> {
        const browser = await this.ensureBrowser();
        if (!BrowserAgent.page || BrowserAgent.page.isClosed()) {
            BrowserAgent.page = await browser.newPage();
            await BrowserAgent.page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
            await BrowserAgent.page.setViewport({ width: 1365, height: 900 });
        }
        return BrowserAgent.page;
    }

    /**
     * Give each browser operation its own page so aborting one task cannot cancel
     * another agent's navigation. The shared browser process remains reusable.
     */
    private async withTaskPage<T>(signal: AbortSignal | undefined, operation: (page: Page) => Promise<T>): Promise<T> {
        if (signal?.aborted) throw new Error('Browser task cancelled.');
        const browser = await this.ensureBrowser();
        if (!browser || !browser.connected) throw new Error('Browser is not connected.');

        const page = await browser.newPage();
        let cancelled = false;
        const closeOnAbort = () => {
            cancelled = true;
            void page.close().catch(() => undefined);
        };
        signal?.addEventListener('abort', closeOnAbort, { once: true });
        try {
            if (signal?.aborted) closeOnAbort();
            if (cancelled) throw new Error('Browser task cancelled.');
            await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
            await page.setViewport({ width: 1365, height: 900 });
            const result = await operation(page);
            if (cancelled || signal?.aborted) throw new Error('Browser task cancelled.');
            return result;
        } finally {
            signal?.removeEventListener('abort', closeOnAbort);
            if (!page.isClosed()) {
                await page.close().catch(() => undefined);
            }
        }
    }

    public async navigateUrl(url: string, signal?: AbortSignal): Promise<string> {
        return this.withTaskPage(signal, async (page) => {
            const normalized = normalizeHttpUrl(url);
            await page.goto(normalized, { waitUntil: 'domcontentloaded' });
            const title = await page.title();
            return `Navigated to ${normalized}\nTitle: ${title || '(untitled)'}`;
        });
    }

    public async getPageContent(url?: string, maxChars = 6000, signal?: AbortSignal): Promise<string> {
        return this.withTaskPage(signal, async (page) => {
            const normalized = url ? normalizeHttpUrl(url) : '';
            if (normalized) {
                await page.goto(normalized, { waitUntil: 'domcontentloaded' });
            }
            const title = await page.title();
            const text = await page.evaluate(() => document.body?.innerText || '');
            const boundedMax = Math.max(500, Math.min(Number(maxChars || 6000), 50000));
            const body = text.length > boundedMax ? `${text.slice(0, boundedMax)}\n...[truncated]` : text;
            return [
                normalized ? `URL: ${normalized}` : '',
                title ? `Title: ${title}` : '',
                '',
                body || '[BROWSER CONTENT]: Page returned no visible text.'
            ].filter(Boolean).join('\n');
        });
    }

    public async summarizeUrl(url: string, maxChars = 12000, signal?: AbortSignal): Promise<string> {
        const content = await this.getPageContent(url, maxChars, signal);
        const lines = content
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => !/^(accept|reject|cookie|privacy settings)$/i.test(line))
            .slice(0, 40);
        return [
            '[URL SUMMARY]',
            ...lines.slice(0, 12).map((line) => `- ${line.length > 220 ? `${line.slice(0, 220)}...` : line}`),
            '',
            '[EXTRACTED TEXT PREVIEW]',
            lines.slice(12, 30).join('\n')
        ].join('\n');
    }

    public async screenshotUrl(url: string | undefined, filePath: string, signal?: AbortSignal): Promise<string> {
        return this.withTaskPage(signal, async (page) => {
            const normalized = url ? normalizeHttpUrl(url) : '';
            if (normalized) {
                await page.goto(normalized, { waitUntil: 'networkidle2' });
            }
            const target = resolveInsideWorkspace(filePath);
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            await page.screenshot({ path: target, fullPage: true });
            return `Screenshot saved to ${target}`;
        });
    }

    public async takeScreenshot(url: string, filePath: string) {
        await this.screenshotUrl(url, filePath);
    }

    public async searchDuckDuckGo(query: string, maxResults = 8, signal?: AbortSignal): Promise<string> {
        return this.withTaskPage(signal, async (page) => {
        const boundedMax = Math.max(1, Math.min(Number(maxResults || 8), 20));
        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const results = await page.evaluate((limit) => {
            const decodeDuckUrl = (href: string) => {
                try {
                    const parsed = new URL(href, window.location.href);
                    const uddg = parsed.searchParams.get('uddg');
                    return uddg ? decodeURIComponent(uddg) : parsed.href;
                } catch {
                    return href;
                }
            };
            const rows = Array.from(document.querySelectorAll('.result, .web-result'));
            return rows.map((row, index) => {
                const anchor = row.querySelector<HTMLAnchorElement>('.result__a, a.result__url, a');
                const snippet = row.querySelector<HTMLElement>('.result__snippet, .result__body, .snippet');
                const rawTitle = anchor?.textContent?.replace(/\s+/g, ' ').trim() || '';
                const rawUrl = anchor?.getAttribute('href') || '';
                return {
                    rank: index + 1,
                    title: rawTitle,
                    url: rawUrl ? decodeDuckUrl(rawUrl) : '',
                    snippet: snippet?.textContent?.replace(/\s+/g, ' ').trim() || ''
                };
            }).filter((result) => result.title && result.url && !result.url.includes('/y.js?') && !result.snippet.toLowerCase().includes(' ad viewing ads '))
                .slice(0, limit)
                .map((result, index) => ({ ...result, rank: index + 1 }));
        }, boundedMax);

        if (!results.length) {
            const text = await page.evaluate(() => document.body?.innerText || '');
            if (text.toLowerCase().includes('please complete the following challenge') || text.toLowerCase().includes('bots use duckduckgo')) {
                return searchDuckDuckGoLite(query, boundedMax, signal);
            }
            return `[DUCKDUCKGO SEARCH] No structured results found for "${query}".\n${text.slice(0, 2000)}`;
        }

        return [
            `[DUCKDUCKGO SEARCH] ${query}`,
            `Results: ${results.length}`,
            '',
            ...results.map((result) => [
                `${result.rank}. ${result.title}`,
                `   URL: ${result.url}`,
                result.snippet ? `   Snippet: ${result.snippet}` : ''
            ].filter(Boolean).join('\n'))
        ].join('\n');
        });
    }

    public async closeBrowser() {
        if (BrowserAgent.browser) await BrowserAgent.browser.close();
        BrowserAgent.browser = null;
        BrowserAgent.page = null;
    }
}

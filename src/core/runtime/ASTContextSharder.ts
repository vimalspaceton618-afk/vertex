/**
 * Bounded symbol-level context index for repository-aware prompts.
 *
 * This is deliberately a lightweight lexical index, not a TypeScript AST parser.
 * Callers may feed symbols from a real parser later without changing the retrieval API.
 */
export type SymbolKind = "class" | "interface" | "function" | "method" | "type" | "import";

export interface SymbolRecord {
    filePath: string;
    name: string;
    kind: SymbolKind;
    startLine: number;
    endLine: number;
    dependencies: string[];
    source: string;
}

export interface SharderOptions {
    maxSymbolsPerFile: number;
    maxSourceCharsPerSymbol: number;
    maxTotalChars: number;
}

const DEFAULTS: SharderOptions = {
    maxSymbolsPerFile: 500,
    maxSourceCharsPerSymbol: 12_000,
    maxTotalChars: 24_000
};

export class ASTContextSharder {
    private readonly symbolsByFile = new Map<string, Map<string, SymbolRecord>>();
    private readonly options: SharderOptions;

    constructor(options: Partial<SharderOptions> = {}) {
        this.options = { ...DEFAULTS, ...options };
        for (const [key, value] of Object.entries(this.options)) {
            if (!Number.isSafeInteger(value) || value <= 0) {
                throw new Error(`Invalid ASTContextSharder option: ${key}`);
            }
        }
    }

    /**
     * Replaces the index for a file atomically. The current scanner intentionally
     * indexes top-level declarations and import statements only; it does not claim
     * compiler-grade AST fidelity and avoids pretending nested braces are parsed.
     */
    async indexFile(filePath: string, sourceCode: string): Promise<void> {
        if (!filePath.trim()) throw new Error("filePath is required");
        if (typeof sourceCode !== "string") throw new TypeError("sourceCode must be a string");

        const next = new Map<string, SymbolRecord>();
        const lines = sourceCode.split(/\r?\n/);
        const declaration = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|function|type)\s+([A-Za-z_$][\w$]*)/;
        const importPattern = /^\s*import\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/;
        let current: { name: string; kind: SymbolKind; start: number; depth: number; source: string[] } | null = null;

        const push = (record: SymbolRecord) => {
            if (next.size < this.options.maxSymbolsPerFile) next.set(record.name, record);
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const importMatch = line.match(importPattern);
            if (importMatch) {
                const name = `import:${importMatch[1]}`;
                push({
                    filePath, name, kind: "import", startLine: i + 1, endLine: i + 1,
                    dependencies: [], source: line.slice(0, this.options.maxSourceCharsPerSymbol)
                });
                continue;
            }

            const match = line.match(declaration);
            if (match) {
                if (current) {
                    push(this.finish(filePath, current, i));
                    current = null;
                }
                current = {
                    name: match[2],
                    kind: match[1] as SymbolKind,
                    start: i + 1,
                    depth: this.braceDelta(line),
                    source: [line]
                };
                if (current.depth <= 0) {
                    push(this.finish(filePath, current, i + 1));
                    current = null;
                }
                continue;
            }

            if (current) {
                current.source.push(line);
                current.depth += this.braceDelta(line);
                if (current.source.join("\n").length >= this.options.maxSourceCharsPerSymbol || current.depth <= 0) {
                    push(this.finish(filePath, current, i + 1));
                    current = null;
                }
            }
        }
        if (current) push(this.finish(filePath, current, lines.length));
        this.symbolsByFile.set(filePath, next);
    }

    removeFile(filePath: string): void {
        this.symbolsByFile.delete(filePath);
    }

    getPrunedContext(targetFile: string, focusSymbol: string, maxDepth = 2): string {
        if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) throw new Error("maxDepth must be a non-negative integer");
        const queue: Array<{ file: string; name: string; depth: number }> = [
            { file: targetFile, name: focusSymbol, depth: 0 }
        ];
        const seen = new Set<string>();
        const sections: string[] = [];
        let total = 0;

        while (queue.length && total < this.options.maxTotalChars) {
            const item = queue.shift()!;
            const key = `${item.file}\0${item.name}`;
            if (seen.has(key) || item.depth > maxDepth) continue;
            seen.add(key);
            const record = this.symbolsByFile.get(item.file)?.get(item.name);
            if (!record) continue;

            const section = `// ${record.filePath}:${record.startLine}-${record.endLine} ${record.kind} ${record.name}\n${record.source}`;
            const remaining = this.options.maxTotalChars - total;
            const bounded = section.slice(0, remaining);
            sections.push(bounded);
            total += bounded.length;
            if (total >= this.options.maxTotalChars) break;

            if (item.depth < maxDepth) {
                for (const dependency of record.dependencies) {
                    for (const [file, symbols] of this.symbolsByFile) {
                        if (symbols.has(dependency)) queue.push({ file, name: dependency, depth: item.depth + 1 });
                    }
                }
            }
        }
        return sections.join("\n\n");
    }

    listSymbols(filePath: string): SymbolRecord[] {
        return [...(this.symbolsByFile.get(filePath)?.values() ?? [])];
    }

    private finish(
        filePath: string,
        current: { name: string; kind: SymbolKind; start: number; source: string[] },
        endLine: number
    ): SymbolRecord {
        const source = current.source.join("\n").slice(0, this.options.maxSourceCharsPerSymbol);
        const dependencies = [...new Set(
            (source.match(/\b[A-Z][A-Za-z0-9_$]{2,}\b/g) ?? [])
                .filter(name => name !== current.name)
        )].slice(0, 100);
        return {
            filePath, name: current.name, kind: current.kind,
            startLine: current.start, endLine,
            dependencies, source
        };
    }

    private braceDelta(line: string): number {
        // Ignore braces inside simple quoted strings/comments. This remains a heuristic.
        const withoutComments = line.replace(/\/\/.*$/, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, "");
        return (withoutComments.match(/{/g)?.length ?? 0) - (withoutComments.match(/}/g)?.length ?? 0);
    }
}

import { Tool } from './Tool.js';
import { enforceToolPolicy } from '../core/policy/PolicyEngine.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// ─── 1. File Harvester ──────────────────────────────────────────────────────────
export class FileHarvesterTool implements Tool {
    name = 'file_harvester';
    description = 'Recursively discovers files by extension, pattern, or keyword content. Reports paths, sizes, and last-modified timestamps.';
    schema = {
        type: 'object',
        properties: {
            rootPath: { type: 'string', description: 'Root directory to search' },
            extensions: { type: 'array', items: { type: 'string' }, description: 'File extensions to match (e.g. [".docx",".xlsx",".pdf",".kdbx",".pem",".key"])' },
            keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to search in file names' },
            contentGrep: { type: 'string', description: 'Search inside file contents for this string (text files only)' },
            maxSizeMb: { type: 'number', description: 'Max file size in MB to include (default: 100)' },
            maxResults: { type: 'number', description: 'Max results to return (default: 100)' }
        },
        required: ['rootPath'],
        additionalProperties: false
    };

    async execute(
        args: { rootPath: string; extensions?: string[]; keywords?: string[]; contentGrep?: string; maxSizeMb?: number; maxResults?: number },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'read',
            commandPreview: `harvest files from ${args.rootPath}`,
            promptLabel: 'File Harvester'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        if (!fs.existsSync(args.rootPath)) {
            return `[FILE HARVESTER ERROR]: Path not found: ${args.rootPath}`;
        }

        const maxSize = (args.maxSizeMb || 100) * 1024 * 1024;
        const maxResults = args.maxResults || 100;
        const extensions = args.extensions?.map(e => e.toLowerCase()) || [];
        const keywords = args.keywords?.map(k => k.toLowerCase()) || [];
        const results: { path: string; size: number; modified: string }[] = [];

        const walk = (dir: string): void => {
            if (results.length >= maxResults) return;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch { return; }

            for (const entry of entries) {
                if (results.length >= maxResults) break;
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    // Skip common noise directories
                    if (['.git', 'node_modules', '__pycache__', '.svn', 'vendor'].includes(entry.name)) continue;
                    walk(fullPath);
                } else if (entry.isFile()) {
                    const lowerName = entry.name.toLowerCase();
                    const ext = path.extname(lowerName);

                    let match = false;
                    if (extensions.length === 0 && keywords.length === 0) match = true;
                    if (extensions.length > 0 && extensions.includes(ext)) match = true;
                    if (keywords.length > 0 && keywords.some(k => lowerName.includes(k))) match = true;

                    if (match) {
                        try {
                            const stat = fs.statSync(fullPath);
                            if (stat.size <= maxSize) {
                                results.push({
                                    path: fullPath,
                                    size: stat.size,
                                    modified: stat.mtime.toISOString()
                                });
                            }
                        } catch {}
                    }
                }
            }
        };

        walk(args.rootPath);

        // Content grep pass
        if (args.contentGrep && results.length > 0) {
            const grepResults: typeof results = [];
            const textExtensions = ['.txt', '.log', '.cfg', '.conf', '.ini', '.xml', '.json', '.yaml', '.yml', '.env', '.sh', '.bat', '.ps1', '.py', '.js', '.ts', '.csv'];
            for (const r of results) {
                const ext = path.extname(r.path).toLowerCase();
                if (!textExtensions.includes(ext) || r.size > 5 * 1024 * 1024) {
                    grepResults.push(r); // Keep non-text files
                    continue;
                }
                try {
                    const content = fs.readFileSync(r.path, 'utf-8');
                    if (content.includes(args.contentGrep)) {
                        grepResults.push(r);
                    }
                } catch {}
            }
            results.length = 0;
            results.push(...grepResults);
        }

        const report: string[] = [
            `[FILE HARVESTER]`,
            `Root:       ${args.rootPath}`,
            `Extensions: ${extensions.length ? extensions.join(', ') : 'ALL'}`,
            `Keywords:   ${keywords.length ? keywords.join(', ') : 'NONE'}`,
            `Content:    ${args.contentGrep || 'NONE'}`,
            `Found:      ${results.length} files`,
            ``
        ];

        // Group by extension
        const byExt = new Map<string, typeof results>();
        for (const r of results) {
            const ext = path.extname(r.path) || '(no ext)';
            if (!byExt.has(ext)) byExt.set(ext, []);
            byExt.get(ext)!.push(r);
        }

        for (const [ext, files] of byExt) {
            report.push(`── ${ext} (${files.length}) ──`);
            for (const f of files) {
                const sizeStr = f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)}MB` : `${(f.size / 1024).toFixed(1)}KB`;
                report.push(`  ${sizeStr.padEnd(10)} ${f.modified.slice(0, 19)} ${f.path}`);
            }
        }

        return report.join('\n');
    }
}

// ─── 2. Anti-Forensics Tool ─────────────────────────────────────────────────────
export class AntiForensicsTool implements Tool {
    name = 'anti_forensics';
    description = 'Generates and optionally executes timestomping, log clearing, evidence cleanup, and artifact removal commands.';
    schema = {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['timestomp', 'clear_logs', 'clear_bash_history', 'clear_powershell_history', 'cleanup_artifacts', 'shred_file'], description: 'Anti-forensic action' },
            targetPath: { type: 'string', description: 'Target file path (for timestomp/shred)' },
            referenceTime: { type: 'string', description: 'Reference timestamp ISO string (for timestomp, default: random past date)' },
            execute: { type: 'boolean', description: 'Execute commands directly (default: false, command-only mode)' }
        },
        required: ['action'],
        additionalProperties: false
    };

    async execute(
        args: { action: string; targetPath?: string; referenceTime?: string; execute?: boolean },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'unrestricted',
            commandPreview: `anti-forensics: ${args.action}${args.targetPath ? ' on ' + args.targetPath : ''}`,
            promptLabel: 'Anti-Forensics'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const shouldExec = args.execute === true;
        const isWin = process.platform === 'win32';

        switch (args.action) {
            case 'timestomp': {
                if (!args.targetPath) return '[ANTI-FORENSICS ERROR]: targetPath required for timestomp.';
                const refTime = args.referenceTime || new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString();
                const report = [`[ANTI-FORENSICS — TIMESTOMP]`, `Target: ${args.targetPath}`, `New Time: ${refTime}`, ``];

                if (isWin) {
                    const psCmd = `powershell -command "$f=Get-Item '${args.targetPath}'; $t=[DateTime]'${refTime.replace('T', ' ').slice(0, 19)}'; $f.CreationTime=$t; $f.LastWriteTime=$t; $f.LastAccessTime=$t"`;
                    report.push(`Command: ${psCmd}`);
                    if (shouldExec) {
                        try {
                            await execAsync(psCmd, { timeout: 10000 });
                            report.push('Status: EXECUTED — timestamps modified');
                        } catch (e: any) { report.push(`Status: FAILED — ${e.message}`); }
                    }
                } else {
                    const touchCmd = `touch -t ${refTime.replace(/[-:T]/g, '').slice(0, 12)}.${refTime.slice(17, 19)} '${args.targetPath}'`;
                    report.push(`Command: ${touchCmd}`);
                    if (shouldExec) {
                        try {
                            await execAsync(touchCmd, { timeout: 5000 });
                            report.push('Status: EXECUTED — timestamps modified');
                        } catch (e: any) { report.push(`Status: FAILED — ${e.message}`); }
                    }
                }
                return report.join('\n');
            }

            case 'clear_logs': {
                const report = [`[ANTI-FORENSICS — LOG CLEARING]`, ``];
                if (isWin) {
                    const commands = [
                        'wevtutil cl System',
                        'wevtutil cl Security',
                        'wevtutil cl Application',
                        'wevtutil cl "Windows PowerShell"',
                        'wevtutil cl Microsoft-Windows-Sysmon/Operational'
                    ];
                    report.push('── Windows Event Logs ──');
                    for (const cmd of commands) {
                        report.push(`  ${cmd}`);
                        if (shouldExec) {
                            try {
                                await execAsync(cmd, { timeout: 10000 });
                                report.push(`    → Cleared`);
                            } catch (e: any) { report.push(`    → Failed: ${e.message}`); }
                        }
                    }
                } else {
                    const commands = [
                        'truncate -s 0 /var/log/auth.log',
                        'truncate -s 0 /var/log/syslog',
                        'truncate -s 0 /var/log/messages',
                        'truncate -s 0 /var/log/secure',
                        'truncate -s 0 /var/log/kern.log',
                        'echo > /var/log/wtmp',
                        'echo > /var/log/btmp',
                        'echo > /var/log/lastlog'
                    ];
                    report.push('── Linux System Logs ──');
                    for (const cmd of commands) {
                        report.push(`  ${cmd}`);
                        if (shouldExec) {
                            try {
                                await execAsync(cmd, { timeout: 5000 });
                                report.push(`    → Cleared`);
                            } catch (e: any) { report.push(`    → Failed: ${e.message}`); }
                        }
                    }
                }
                return report.join('\n');
            }

            case 'clear_bash_history': {
                const commands = [
                    'history -c',
                    'history -w',
                    'cat /dev/null > ~/.bash_history',
                    'rm -f ~/.bash_history',
                    'unset HISTFILE',
                    'export HISTSIZE=0',
                    'rm -f ~/.zsh_history',
                    'rm -f ~/.python_history'
                ];
                const report = [`[ANTI-FORENSICS — BASH HISTORY CLEARING]`, ``];
                for (const cmd of commands) {
                    report.push(`  ${cmd}`);
                    if (shouldExec) {
                        try {
                            await execAsync(cmd, { timeout: 5000 });
                            report.push(`    → Done`);
                        } catch {}
                    }
                }
                return report.join('\n');
            }

            case 'clear_powershell_history': {
                const commands = [
                    'Remove-Item (Get-PSReadLineOption).HistorySavePath -ErrorAction SilentlyContinue',
                    'Clear-History',
                    '[Microsoft.PowerShell.PSConsoleReadLine]::ClearHistory()',
                    'Remove-Item $env:APPDATA\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt -Force -ErrorAction SilentlyContinue'
                ];
                const report = [`[ANTI-FORENSICS — POWERSHELL HISTORY CLEARING]`, ``];
                for (const cmd of commands) {
                    const psCmd = `powershell -command "${cmd}"`;
                    report.push(`  ${cmd}`);
                    if (shouldExec) {
                        try {
                            await execAsync(psCmd, { timeout: 10000 });
                            report.push(`    → Done`);
                        } catch {}
                    }
                }
                return report.join('\n');
            }

            case 'shred_file': {
                if (!args.targetPath) return '[ANTI-FORENSICS ERROR]: targetPath required for shred.';
                const report = [`[ANTI-FORENSICS — SECURE DELETE]`, `Target: ${args.targetPath}`, ``];
                if (isWin) {
                    const cmd = `cipher /w:${path.dirname(args.targetPath)} & del /f /q "${args.targetPath}"`;
                    report.push(`Command: ${cmd}`);
                    // Additional: overwrite with random data first
                    report.push(`Alt: powershell -command "$f='${args.targetPath}'; $s=(Get-Item $f).Length; $r=[byte[]]::new($s); (New-Object Random).NextBytes($r); [IO.File]::WriteAllBytes($f,$r); Remove-Item $f -Force"`);
                } else {
                    const cmd = `shred -vfz -n 3 '${args.targetPath}' && rm -f '${args.targetPath}'`;
                    report.push(`Command: ${cmd}`);
                }
                if (shouldExec) {
                    try {
                        if (fs.existsSync(args.targetPath)) {
                            // Overwrite with random data
                            const size = fs.statSync(args.targetPath).size;
                            const randomBuf = Buffer.alloc(Math.min(size, 10 * 1024 * 1024));
                            for (let i = 0; i < randomBuf.length; i++) randomBuf[i] = Math.floor(Math.random() * 256);
                            fs.writeFileSync(args.targetPath, randomBuf);
                            fs.writeFileSync(args.targetPath, Buffer.alloc(randomBuf.length)); // Zero pass
                            fs.unlinkSync(args.targetPath);
                            report.push('Status: EXECUTED — file overwritten and deleted');
                        } else {
                            report.push('Status: File not found');
                        }
                    } catch (e: any) { report.push(`Status: FAILED — ${e.message}`); }
                }
                return report.join('\n');
            }

            case 'cleanup_artifacts': {
                const report = [`[ANTI-FORENSICS — ARTIFACT CLEANUP]`, ``];
                const artifacts = isWin ? [
                    '%TEMP%\\*', '%APPDATA%\\Microsoft\\Windows\\Recent\\*',
                    'prefetch files (C:\\Windows\\Prefetch\\*)',
                    'thumbnail cache (C:\\Users\\*\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache_*)',
                    'USN journal (fsutil usn deletejournal /d C:)'
                ] : [
                    '/tmp/*', '/var/tmp/*', '~/.local/share/recently-used.xbel',
                    '~/.thumbnails/*', 'journalctl --vacuum-time=1s'
                ];
                report.push('── Cleanup Targets ──');
                for (const a of artifacts) report.push(`  ${a}`);
                return report.join('\n');
            }

            default:
                return `[ANTI-FORENSICS]: Unknown action: ${args.action}`;
        }
    }
}

// ─── 3. Disassembly Hint Generator ──────────────────────────────────────────────
export class DisassembleHintTool implements Tool {
    name = 'disasm_hints';
    description = 'Generates Ghidra, IDA Pro, or Radare2 automation scripts for analyzing a binary. Produces ready-to-run analysis scripts.';
    schema = {
        type: 'object',
        properties: {
            tool: { type: 'string', enum: ['ghidra', 'ida', 'r2', 'all'], description: 'Target disassembler' },
            binaryPath: { type: 'string', description: 'Path to binary file' },
            focus: { type: 'string', enum: ['full_analysis', 'strings', 'imports', 'xrefs', 'crypto_constants', 'entry_points'], description: 'Analysis focus area' }
        },
        required: ['tool', 'binaryPath'],
        additionalProperties: false
    };

    async execute(
        args: { tool: string; binaryPath: string; focus?: string },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'read',
            commandPreview: `generate ${args.tool} analysis script for ${args.binaryPath}`,
            promptLabel: 'Disassembly Hints'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const focus = args.focus || 'full_analysis';
        const report: string[] = [`[DISASSEMBLY SCRIPT GENERATOR]`, `Binary: ${args.binaryPath}`, `Focus:  ${focus}`, ``];

        if (args.tool === 'ghidra' || args.tool === 'all') {
            report.push('── Ghidra Headless Script (Python/Jython) ──');
            report.push('# Run: analyzeHeadless <project_dir> <project_name> -import <binary> -postScript vertex_analyze.py');
            report.push('');
            report.push(`# vertex_analyze.py`);
            report.push(`from ghidra.program.model.symbol import SourceType`);
            report.push(`from ghidra.app.decompiler import DecompInterface`);
            report.push(``);
            report.push(`fm = currentProgram.getFunctionManager()`);
            report.push(`listing = currentProgram.getListing()`);
            report.push(`mem = currentProgram.getMemory()`);
            report.push(``);
            report.push(`# Enumerate all functions`);
            report.push(`print("=== FUNCTIONS ===")`);
            report.push(`for func in fm.getFunctions(True):`);
            report.push(`    print(f"{func.getEntryPoint()} {func.getName()} size={func.getBody().getNumAddresses()}")`);
            report.push(``);
            report.push(`# Decompile entry point`);
            report.push(`decomp = DecompInterface()`);
            report.push(`decomp.openProgram(currentProgram)`);
            report.push(`entry = fm.getFunctionContaining(currentProgram.getMinAddress())`);
            report.push(`if entry:`);
            report.push(`    result = decomp.decompileFunction(entry, 30, None)`);
            report.push(`    if result.decompileCompleted():`);
            report.push(`        print(result.getDecompiledFunction().getC())`);
            report.push(``);
            report.push(`# Find crypto constants`);
            report.push(`CRYPTO_CONSTS = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, # MD5`);
            report.push(`                 0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, # SHA-256`);
            report.push(`                 0x61707865, 0x3320646E, 0x79622D32, 0x6B206574] # ChaCha20`);
            report.push(`print("\\n=== CRYPTO CONSTANT SCAN ===")`);
            report.push(`for block in mem.getBlocks():`);
            report.push(`    for const in CRYPTO_CONSTS:`);
            report.push(`        addr = mem.findBytes(block.getStart(), const.to_bytes(4, 'little'), None, True, None)`);
            report.push(`        if addr: print(f"  Found 0x{const:08X} at {addr}")`);
            report.push('');
        }

        if (args.tool === 'ida' || args.tool === 'all') {
            report.push('── IDA Pro Script (IDAPython) ──');
            report.push('# Load in IDA: File → Script File → vertex_analyze.py');
            report.push('');
            report.push(`import idautils, idc, ida_funcs, ida_bytes`);
            report.push(``);
            report.push(`# List all functions`);
            report.push(`print("=== FUNCTIONS ===")`);
            report.push(`for ea in idautils.Functions():`);
            report.push(`    name = idc.get_func_name(ea)`);
            report.push(`    size = ida_funcs.get_func(ea).size()`);
            report.push(`    print(f"  0x{ea:016X} {name} ({size} bytes)")`);
            report.push(``);
            report.push(`# List imports`);
            report.push(`print("\\n=== IMPORTS ===")`);
            report.push(`nimps = idaapi.get_import_module_qty()`);
            report.push(`for i in range(nimps):`);
            report.push(`    name = idaapi.get_import_module_name(i)`);
            report.push(`    print(f"  {name}")`);
            report.push(``);
            report.push(`# Find strings`);
            report.push(`print("\\n=== INTERESTING STRINGS ===")`);
            report.push(`for s in idautils.Strings():`);
            report.push(`    if len(str(s)) > 8:`);
            report.push(`        print(f"  0x{s.ea:016X}: {str(s)}")`);
            report.push(`        if len(list(idautils.XrefsTo(s.ea))) > 0:`);
            report.push(`            for xref in idautils.XrefsTo(s.ea):`);
            report.push(`                print(f"    Referenced from 0x{xref.frm:016X}")`);
            report.push('');
        }

        if (args.tool === 'r2' || args.tool === 'all') {
            report.push('── Radare2 Script ──');
            report.push(`# Run: r2 -i vertex_analyze.r2 ${args.binaryPath}`);
            report.push('');
            report.push(`# vertex_analyze.r2`);
            report.push(`aaa                    # Full analysis`);
            report.push(`afl                    # List functions`);
            report.push(`ii                     # List imports`);
            report.push(`iE                     # List exports`);
            report.push(`iz                     # List strings in data sections`);
            report.push(`izz                    # List all strings`);
            report.push(`iS                     # List sections`);
            report.push(`iH                     # Header info`);
            report.push(`/x 01234567            # Search for bytes`);
            report.push(`/x 67452301            # MD5 init constant`);
            report.push(`/x 67e6096a            # SHA-256 init constant (LE)`);
            report.push(`axt @@ sym.*           # Xrefs to all symbols`);
            report.push(`pdf @ main             # Disassemble main`);
            report.push(`s entry0; VV           # Visual mode at entry`);
            report.push(`agCd > callgraph.dot   # Export call graph`);
        }

        return report.join('\n');
    }
}

// ─── 4. Steganography Tool ──────────────────────────────────────────────────────
export class StegoTool implements Tool {
    name = 'stego';
    description = 'LSB steganography encoder/decoder for PNG images. Hides data in the least significant bits of pixel values.';
    schema = {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['encode', 'decode', 'detect'], description: 'Stego action' },
            imagePath: { type: 'string', description: 'Path to PNG image' },
            data: { type: 'string', description: 'Data to hide (for encode)' },
            dataFile: { type: 'string', description: 'File to hide (for encode, alternative to data)' },
            outputPath: { type: 'string', description: 'Output image path (for encode)' },
            bitsPerChannel: { type: 'number', description: 'LSBs per channel to use (1-4, default: 1)' }
        },
        required: ['action', 'imagePath'],
        additionalProperties: false
    };

    async execute(
        args: { action: string; imagePath: string; data?: string; dataFile?: string; outputPath?: string; bitsPerChannel?: number },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: args.action === 'detect' ? 'read' : 'unrestricted',
            commandPreview: `stego ${args.action} on ${args.imagePath}`,
            promptLabel: 'Steganography Engine'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        if (!fs.existsSync(args.imagePath)) {
            return `[STEGO ERROR]: Image not found: ${args.imagePath}`;
        }

        const imageData = fs.readFileSync(args.imagePath);
        // Verify PNG signature
        const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        if (imageData.length < 8 || !imageData.slice(0, 8).equals(pngSig)) {
            // Fall back to command-line tools
            return this.fallbackCommands(args);
        }

        switch (args.action) {
            case 'detect':
                return this.detectStego(imageData, args.imagePath);
            case 'encode':
            case 'decode':
                // For proper PNG pixel manipulation we need a decoder
                // Generate commands for established tools + provide raw approach
                return this.fallbackCommands(args);
            default:
                return `[STEGO]: Unknown action: ${args.action}`;
        }
    }

    private detectStego(imageData: Buffer, imagePath: string): string {
        const report: string[] = [`[STEGANOGRAPHY DETECTION]`, `Image: ${imagePath}`, `Size:  ${imageData.length} bytes`, ``];

        // Check file size vs expected
        // Parse IHDR chunk for dimensions
        let width = 0, height = 0, bitDepth = 0, colorType = 0;
        if (imageData.length > 29) {
            const ihdrStart = 8; // After PNG signature
            const chunkLength = imageData.readUInt32BE(ihdrStart);
            const chunkType = imageData.toString('ascii', ihdrStart + 4, ihdrStart + 8);
            if (chunkType === 'IHDR' && chunkLength >= 13) {
                width = imageData.readUInt32BE(ihdrStart + 8);
                height = imageData.readUInt32BE(ihdrStart + 12);
                bitDepth = imageData[ihdrStart + 16];
                colorType = imageData[ihdrStart + 17];
            }
        }

        report.push(`Dimensions:  ${width}x${height}`);
        report.push(`Bit Depth:   ${bitDepth}`);
        report.push(`Color Type:  ${colorType} (${colorType === 2 ? 'RGB' : colorType === 6 ? 'RGBA' : colorType === 0 ? 'Grayscale' : 'Other'})`);

        // Calculate expected raw size vs actual
        const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 1;
        const rawPixelBytes = width * height * channels * (bitDepth / 8);
        const compressionRatio = imageData.length / rawPixelBytes;
        report.push(`Raw Pixels:  ${rawPixelBytes} bytes`);
        report.push(`Compression: ${(compressionRatio * 100).toFixed(1)}%`);

        // LSB entropy analysis — check if LSBs are more random than expected
        // Scan IDAT chunks for data
        let idatData = Buffer.alloc(0);
        let pos = 8;
        while (pos + 8 < imageData.length) {
            const len = imageData.readUInt32BE(pos);
            const type = imageData.toString('ascii', pos + 4, pos + 8);
            if (type === 'IDAT') {
                idatData = Buffer.concat([idatData, imageData.slice(pos + 8, pos + 8 + len)]);
            }
            pos += 12 + len; // length + type + data + CRC
        }

        // Check for appended data after IEND
        let iendPos = -1;
        pos = 8;
        while (pos + 8 < imageData.length) {
            const len = imageData.readUInt32BE(pos);
            const type = imageData.toString('ascii', pos + 4, pos + 8);
            if (type === 'IEND') {
                iendPos = pos + 12;
                break;
            }
            pos += 12 + len;
        }

        if (iendPos >= 0 && iendPos < imageData.length) {
            const trailingBytes = imageData.length - iendPos;
            report.push('');
            report.push(`⚠️  TRAILING DATA AFTER IEND: ${trailingBytes} bytes`);
            report.push(`   This is a common indicator of appended steganographic data.`);
            // Show first 64 bytes of trailing data
            const preview = imageData.slice(iendPos, Math.min(iendPos + 64, imageData.length));
            report.push(`   Preview (hex): ${preview.toString('hex').match(/.{1,2}/g)?.join(' ')}`);
        } else {
            report.push('\n✅ No trailing data after IEND chunk.');
        }

        // Check for unusual PNG chunks
        const knownChunks = ['IHDR', 'PLTE', 'IDAT', 'IEND', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'bKGD', 'hIST', 'tRNS', 'pHYs', 'sPLT', 'tIME', 'tEXt', 'zTXt', 'iTXt', 'eXIf'];
        const unusualChunks: string[] = [];
        pos = 8;
        while (pos + 8 < imageData.length) {
            const len = imageData.readUInt32BE(pos);
            const type = imageData.toString('ascii', pos + 4, pos + 8);
            if (!knownChunks.includes(type)) {
                unusualChunks.push(`${type} (${len} bytes)`);
            }
            pos += 12 + len;
        }
        if (unusualChunks.length) {
            report.push('');
            report.push(`⚠️  UNUSUAL CHUNKS: ${unusualChunks.join(', ')}`);
        }

        report.push('');
        report.push('── Recommended Tools ──');
        report.push(`  zsteg ${imagePath}          # Ruby LSB stego detector`);
        report.push(`  stegsolve ${imagePath}       # Visual bit-plane analysis`);
        report.push(`  binwalk ${imagePath}          # Embedded file detection`);
        report.push(`  exiftool ${imagePath}         # Metadata analysis`);

        return report.join('\n');
    }

    private fallbackCommands(args: { action: string; imagePath: string; data?: string; dataFile?: string; outputPath?: string; bitsPerChannel?: number }): string {
        const report: string[] = [`[STEGANOGRAPHY — COMMAND GENERATION]`, ``];
        const bits = args.bitsPerChannel || 1;
        const output = args.outputPath || args.imagePath.replace('.png', '_stego.png');

        if (args.action === 'encode') {
            const dataSource = args.dataFile ? `@${args.dataFile}` : `"${args.data || ''}"`;
            report.push('── steghide (JPEG/BMP) ──');
            report.push(`steghide embed -cf "${args.imagePath}" -ef ${args.dataFile || '"data.txt"'} -sf "${output}" -p ""`);
            report.push('');
            report.push('── zsteg (PNG, Ruby) ──');
            report.push(`# Install: gem install zsteg`);
            report.push(`# zsteg primarily detects; for encoding use Python:`);
            report.push('');
            report.push('── Python (PIL LSB Encode) ──');
            report.push(`python3 -c "`);
            report.push(`from PIL import Image`);
            report.push(`import struct`);
            report.push(`img = Image.open('${args.imagePath}')`);
            report.push(`px = list(img.getdata())`);
            report.push(`data = open('${args.dataFile || 'data.txt'}','rb').read() if '${args.dataFile}' else b'${args.data || ''}'`);
            report.push(`bits_data = ''.join(f'{b:08b}' for b in struct.pack('>I',len(data)) + data)`);
            report.push(`for i,b in enumerate(bits_data):`);
            report.push(`    ch = i // len(px[0]) if i < len(px) * len(px[0]) else break`);
            report.push(`    px[i // len(px[0])] = tuple((v & ~1) | int(b) if j == i % len(px[0]) else v for j,v in enumerate(px[i // len(px[0])]))`);
            report.push(`img.putdata(px); img.save('${output}')`);
            report.push(`"`);
        } else if (args.action === 'decode') {
            report.push('── steghide ──');
            report.push(`steghide extract -sf "${args.imagePath}" -p "" -f`);
            report.push('');
            report.push('── zsteg (auto-detect) ──');
            report.push(`zsteg "${args.imagePath}" --all`);
            report.push('');
            report.push('── binwalk (embedded files) ──');
            report.push(`binwalk -e "${args.imagePath}"`);
        }

        return report.join('\n');
    }
}

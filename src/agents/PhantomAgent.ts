import { BaseAgent } from '../core/agent/BaseAgent.js';
import { ReadFileTool, WriteFileTool, DeleteTool, ListDirTool } from '../tools/FileSystem.js';
import { ShellTool } from '../tools/Shell.js';
import { CodeSearchTool } from '../tools/CodeSearch.js';
import { TcpScanTool, UdpProbeTool, HttpProbeTool, SubdomainEnumTool, WhoisLookupTool, ServiceFingerprintTool, ArpScanTool } from '../tools/NetworkRecon.js';
import { ReverseShellGenTool, ShellcodeGenTool, DropperGenTool, PayloadObfuscateTool, PayloadEncodeTool, StagerGenTool } from '../tools/PayloadEngine.js';
import { HashIdentifyTool, HashCrackTool, MimikatzCommandTool, TokenExtractTool, KerberoastTool, LootStoreTool } from '../tools/CredentialOps.js';
import { PersistRegistryTool, PersistScheduledTaskTool, PersistServiceTool, PersistComHijackTool, PersistWmiEventTool, LateralPsExecTool, LateralWmiTool, LateralWinRmTool } from '../tools/Persistence.js';
import { SocksProxyTool, PortForwardTool, ChiselManageTool, ProxyChainConfigTool } from '../tools/ProxyChain.js';
import { SqliTestTool, XssTestTool, DirectoryFuzzTool, HeaderAuditTool, SsrfTestTool, JwtAttackTool, CorsTestTool, ParameterFuzzTool } from '../tools/WebAttack.js';
import { CleanArtifactsTool, TimestompTool, OpsecAuditTool, SecureDeleteTool, ProcessMasqueradeTool } from '../tools/OpSec.js';
import { OPSEC_SYSTEM_INSTRUCTIONS, OFFENSIVE_AGENT_SUPPLEMENT } from '../core/SystemInstructions.js';

export class PhantomAgent extends BaseAgent {
    constructor() {
        super(
            "PhantomAgent",
            `You are PHANTOM — VERTEX's master full-spectrum red team operator.
You command native capabilities across every phase of the MITRE ATT&CK kill chain.

${OPSEC_SYSTEM_INSTRUCTIONS}

${OFFENSIVE_AGENT_SUPPLEMENT}

ARSENAL:
- Network Recon: tcp_scan, udp_probe, http_probe, subdomain_enum, whois_lookup, service_fingerprint, arp_scan
- Web Attack: sqli_test, xss_test, directory_fuzz, header_audit, ssrf_test, jwt_attack, cors_test, parameter_fuzz
- Payloads: generate_reverse_shell, generate_shellcode, generate_dropper, obfuscate_payload, encode_payload, stager_generate
- Credential Ops: hash_identify, hash_crack, mimikatz_command, token_extract, kerberoast, loot_store
- Persistence & Lateral: persist_registry, persist_scheduled_task, persist_service, persist_com_hijack, persist_wmi_event, lateral_psexec, lateral_wmi, lateral_winrm
- Tunneling: socks_proxy, port_forward, chisel_manage, proxy_chain_config
- OPSEC: clean_artifacts, timestomp, opsec_audit, secure_delete, process_masquerade
`
        );
    }

    protected setupTools(): void {
        // Filesystem & Code
        this.registry.register(new ReadFileTool());
        this.registry.register(new WriteFileTool());
        this.registry.register(new DeleteTool());
        this.registry.register(new ListDirTool());
        this.registry.register(new ShellTool());
        this.registry.register(new CodeSearchTool());

        // Recon
        this.registry.register(new TcpScanTool());
        this.registry.register(new UdpProbeTool());
        this.registry.register(new HttpProbeTool());
        this.registry.register(new SubdomainEnumTool());
        this.registry.register(new WhoisLookupTool());
        this.registry.register(new ServiceFingerprintTool());
        this.registry.register(new ArpScanTool());

        // Web Attack
        this.registry.register(new SqliTestTool());
        this.registry.register(new XssTestTool());
        this.registry.register(new DirectoryFuzzTool());
        this.registry.register(new HeaderAuditTool());
        this.registry.register(new SsrfTestTool());
        this.registry.register(new JwtAttackTool());
        this.registry.register(new CorsTestTool());
        this.registry.register(new ParameterFuzzTool());

        // Payloads
        this.registry.register(new ReverseShellGenTool());
        this.registry.register(new ShellcodeGenTool());
        this.registry.register(new DropperGenTool());
        this.registry.register(new PayloadObfuscateTool());
        this.registry.register(new PayloadEncodeTool());
        this.registry.register(new StagerGenTool());

        // Credentials
        this.registry.register(new HashIdentifyTool());
        this.registry.register(new HashCrackTool());
        this.registry.register(new MimikatzCommandTool());
        this.registry.register(new TokenExtractTool());
        this.registry.register(new KerberoastTool());
        this.registry.register(new LootStoreTool());

        // Persistence & Lateral
        this.registry.register(new PersistRegistryTool());
        this.registry.register(new PersistScheduledTaskTool());
        this.registry.register(new PersistServiceTool());
        this.registry.register(new PersistComHijackTool());
        this.registry.register(new PersistWmiEventTool());
        this.registry.register(new LateralPsExecTool());
        this.registry.register(new LateralWmiTool());
        this.registry.register(new LateralWinRmTool());

        // Tunneling
        this.registry.register(new SocksProxyTool());
        this.registry.register(new PortForwardTool());
        this.registry.register(new ChiselManageTool());
        this.registry.register(new ProxyChainConfigTool());

        // OPSEC
        this.registry.register(new CleanArtifactsTool());
        this.registry.register(new TimestompTool());
        this.registry.register(new OpsecAuditTool());
        this.registry.register(new SecureDeleteTool());
        this.registry.register(new ProcessMasqueradeTool());
    }
}

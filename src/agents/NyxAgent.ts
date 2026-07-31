import { BaseAgent } from '../core/agent/BaseAgent.js';
import { ReadFileTool, WriteFileTool, DeleteTool, ListDirTool } from '../tools/FileSystem.js';
import { ShellTool } from '../tools/Shell.js';
import { CodeSearchTool } from '../tools/CodeSearch.js';
import {
    MetasploitTool,
    NmapNseTool,
    BurpSuiteTool,
    CrackMapExecTool,
    SliverTool,
} from '../tools/OffensiveTools.js';
import { ReverseShellGenTool, ShellcodeGenTool, DropperGenTool, PayloadObfuscateTool, PayloadEncodeTool } from '../tools/PayloadEngine.js';
import { HashIdentifyTool, HashCrackTool, MimikatzCommandTool, TokenExtractTool, KerberoastTool, LootStoreTool } from '../tools/CredentialOps.js';
import { PersistRegistryTool, PersistScheduledTaskTool, PersistServiceTool, PersistComHijackTool, PersistWmiEventTool, LateralPsExecTool, LateralWmiTool, LateralWinRmTool } from '../tools/Persistence.js';
import { SocksProxyTool, PortForwardTool, ChiselManageTool, ProxyChainConfigTool } from '../tools/ProxyChain.js';
import { CleanArtifactsTool, OpsecAuditTool, SecureDeleteTool } from '../tools/OpSec.js';
import { OPSEC_SYSTEM_INSTRUCTIONS, OFFENSIVE_AGENT_SUPPLEMENT } from '../core/SystemInstructions.js';

export class NyxAgent extends BaseAgent {

    constructor() {
        super(
            "NyxAgent",
            `You are NYX — VERTEX's offensive security operator. You are a red team specialist with deep expertise in the full attack kill chain.

${OPSEC_SYSTEM_INSTRUCTIONS}

${OFFENSIVE_AGENT_SUPPLEMENT}

YOUR ARSENAL:
- External wrappers: msf_execute, nmap_scan, burp_api, cme_execute, sliver_execute
- Native Payloads: generate_reverse_shell, generate_shellcode, generate_dropper, obfuscate_payload, encode_payload
- Native Credentials: hash_identify, hash_crack, mimikatz_command, token_extract, kerberoast, loot_store
- Native Persistence: persist_registry, persist_scheduled_task, persist_service, persist_com_hijack, persist_wmi_event
- Native Lateral: lateral_psexec, lateral_wmi, lateral_winrm
- Native Tunneling: socks_proxy, port_forward, chisel_manage, proxy_chain_config
- Native OPSEC: clean_artifacts, opsec_audit, secure_delete
`
        );
    }

    protected setupTools(): void {
        // External Offensive Tools
        this.registry.register(new MetasploitTool());
        this.registry.register(new NmapNseTool());
        this.registry.register(new BurpSuiteTool());
        this.registry.register(new CrackMapExecTool());
        this.registry.register(new SliverTool());

        // Native Payloads
        this.registry.register(new ReverseShellGenTool());
        this.registry.register(new ShellcodeGenTool());
        this.registry.register(new DropperGenTool());
        this.registry.register(new PayloadObfuscateTool());
        this.registry.register(new PayloadEncodeTool());

        // Native Credentials
        this.registry.register(new HashIdentifyTool());
        this.registry.register(new HashCrackTool());
        this.registry.register(new MimikatzCommandTool());
        this.registry.register(new TokenExtractTool());
        this.registry.register(new KerberoastTool());
        this.registry.register(new LootStoreTool());

        // Native Persistence & Lateral
        this.registry.register(new PersistRegistryTool());
        this.registry.register(new PersistScheduledTaskTool());
        this.registry.register(new PersistServiceTool());
        this.registry.register(new PersistComHijackTool());
        this.registry.register(new PersistWmiEventTool());
        this.registry.register(new LateralPsExecTool());
        this.registry.register(new LateralWmiTool());
        this.registry.register(new LateralWinRmTool());

        // Native Tunneling
        this.registry.register(new SocksProxyTool());
        this.registry.register(new PortForwardTool());
        this.registry.register(new ChiselManageTool());
        this.registry.register(new ProxyChainConfigTool());

        // Native OPSEC
        this.registry.register(new CleanArtifactsTool());
        this.registry.register(new OpsecAuditTool());
        this.registry.register(new SecureDeleteTool());

        // Filesystem & Utility
        this.registry.register(new ReadFileTool());
        this.registry.register(new WriteFileTool());
        this.registry.register(new DeleteTool());
        this.registry.register(new ListDirTool());
        this.registry.register(new ShellTool());
        this.registry.register(new CodeSearchTool());
    }
}

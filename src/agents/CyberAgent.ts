import { BaseAgent } from '../core/agent/BaseAgent.js';
import { ReadFileTool, WriteFileTool, ListDirTool } from '../tools/FileSystem.js';
import { ShellTool } from '../tools/Shell.js';
import { DockerSandboxTool, SafetyResearchSandboxTool } from '../tools/DockerSandbox.js';
import {
    DnsLookupTool,
    PortScanTool,
    NetworkAuditTool,
    FileIntegrityTool,
    ProcessInspectorTool,
    EnvSecretsScannerTool,
} from '../tools/LinuxSecurity.js';
import { YaraScanTool, LogAnalyzeTool, IocCheckTool, BaselineDiffTool, MemoryStringsTool, TimelineForensicsTool } from '../tools/DefenseOps.js';
import { OpsecAuditTool } from '../tools/OpSec.js';
import { OPSEC_SYSTEM_INSTRUCTIONS, DEFENSIVE_AGENT_SUPPLEMENT } from '../core/SystemInstructions.js';

export class CyberAgent extends BaseAgent {

    constructor() {
        super(
            "CyberAgent",
            `You are VERTEX CyberAgent — a specialized, elite cybersecurity analyst and penetration testing assistant.

${OPSEC_SYSTEM_INSTRUCTIONS}

${DEFENSIVE_AGENT_SUPPLEMENT}

YOUR ARSENAL:
- Sandboxing: sandbox_execute, safety_sandbox_execute
- System Audit: dns_lookup, port_scan, network_audit, file_integrity, process_inspect, env_secrets_scan
- Defensive Forensics: yara_scan, log_analyze, ioc_check, baseline_diff, memory_strings, timeline_forensics
- Security Audit: opsec_audit
`
        );
    }

    protected setupTools(): void {
        // Sandboxing
        this.registry.register(new DockerSandboxTool());
        this.registry.register(new SafetyResearchSandboxTool());

        // Linux Security Suite
        this.registry.register(new DnsLookupTool());
        this.registry.register(new PortScanTool());
        this.registry.register(new NetworkAuditTool());
        this.registry.register(new FileIntegrityTool());
        this.registry.register(new ProcessInspectorTool());
        this.registry.register(new EnvSecretsScannerTool());

        // Defensive Operations
        this.registry.register(new YaraScanTool());
        this.registry.register(new LogAnalyzeTool());
        this.registry.register(new IocCheckTool());
        this.registry.register(new BaselineDiffTool());
        this.registry.register(new MemoryStringsTool());
        this.registry.register(new TimelineForensicsTool());
        this.registry.register(new OpsecAuditTool());

        // Filesystem & Diagnostics
        this.registry.register(new ReadFileTool());
        this.registry.register(new WriteFileTool());
        this.registry.register(new ListDirTool());
        this.registry.register(new ShellTool());
    }
}

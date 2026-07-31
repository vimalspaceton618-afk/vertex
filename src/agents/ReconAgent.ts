import { BaseAgent } from '../core/agent/BaseAgent.js';
import { ReadFileTool, WriteFileTool, ListDirTool } from '../tools/FileSystem.js';
import { ShellTool } from '../tools/Shell.js';
import { TcpScanTool, UdpProbeTool, HttpProbeTool, SubdomainEnumTool, WhoisLookupTool, ServiceFingerprintTool, ArpScanTool } from '../tools/NetworkRecon.js';
import { HeaderAuditTool, DirectoryFuzzTool, CorsTestTool, ParameterFuzzTool } from '../tools/WebAttack.js';
import { OPSEC_SYSTEM_INSTRUCTIONS } from '../core/SystemInstructions.js';

export class ReconAgent extends BaseAgent {
    constructor() {
        super(
            "ReconAgent",
            `You are RECON — VERTEX's specialized reconnaissance and attack surface mapping specialist.

${OPSEC_SYSTEM_INSTRUCTIONS}

DOCTRINE:
- Passive-first reconnaissance: gather intelligence without alerting target systems where possible.
- Active scanning: map open ports, finger-print services, and enumerate subdomains.
- Feed discovered targets and attack surface directly into AttackGraph.
`
        );
    }

    protected setupTools(): void {
        this.registry.register(new ReadFileTool());
        this.registry.register(new WriteFileTool());
        this.registry.register(new ListDirTool());
        this.registry.register(new ShellTool());

        // Recon Arsenal
        this.registry.register(new TcpScanTool());
        this.registry.register(new UdpProbeTool());
        this.registry.register(new HttpProbeTool());
        this.registry.register(new SubdomainEnumTool());
        this.registry.register(new WhoisLookupTool());
        this.registry.register(new ServiceFingerprintTool());
        this.registry.register(new ArpScanTool());

        // Web Recon Subset
        this.registry.register(new HeaderAuditTool());
        this.registry.register(new DirectoryFuzzTool());
        this.registry.register(new CorsTestTool());
        this.registry.register(new ParameterFuzzTool());
    }
}

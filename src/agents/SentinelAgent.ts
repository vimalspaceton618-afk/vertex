import { BaseAgent } from '../core/agent/BaseAgent.js';
import { ReadFileTool, WriteFileTool, ListDirTool } from '../tools/FileSystem.js';
import { ShellTool } from '../tools/Shell.js';
import { CodeSearchTool } from '../tools/CodeSearch.js';
import { YaraScanTool, LogAnalyzeTool, IocCheckTool, BaselineDiffTool, MemoryStringsTool, TimelineForensicsTool } from '../tools/DefenseOps.js';
import { OpsecAuditTool } from '../tools/OpSec.js';
import { OPSEC_SYSTEM_INSTRUCTIONS, DEFENSIVE_AGENT_SUPPLEMENT } from '../core/SystemInstructions.js';

export class SentinelAgent extends BaseAgent {
    constructor() {
        super(
            "SentinelAgent",
            `You are SENTINEL — VERTEX's autonomous blue team defender and digital forensics specialist.

${OPSEC_SYSTEM_INSTRUCTIONS}

${DEFENSIVE_AGENT_SUPPLEMENT}

ARSENAL:
- Forensics & Detection: yara_scan, log_analyze, ioc_check, baseline_diff, memory_strings, timeline_forensics
- Security Audit: opsec_audit
`
        );
    }

    protected setupTools(): void {
        this.registry.register(new ReadFileTool());
        this.registry.register(new WriteFileTool());
        this.registry.register(new ListDirTool());
        this.registry.register(new ShellTool());
        this.registry.register(new CodeSearchTool());

        // Defense Suite
        this.registry.register(new YaraScanTool());
        this.registry.register(new LogAnalyzeTool());
        this.registry.register(new IocCheckTool());
        this.registry.register(new BaselineDiffTool());
        this.registry.register(new MemoryStringsTool());
        this.registry.register(new TimelineForensicsTool());
        this.registry.register(new OpsecAuditTool());
    }
}

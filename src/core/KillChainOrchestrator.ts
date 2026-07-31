import { Tool } from '../tools/Tool.js';
import { getAttackGraph, AttackPhase } from './AttackGraph.js';
import { getSessionManager } from './SessionManager.js';
import { AgentManager } from './agent/AgentManager.js';

/**
 * Handles the state machine of the engagement.
 */
export class KillChainOrchestrator {
    private currentPhase: AttackPhase = 'recon';
    private phases: AttackPhase[] = [
        'recon',
        'discovery',
        'execution',
        'privilege_escalation',
        'defense_evasion',
        'credential_access',
        'lateral_movement',
        'collection',
        'command_and_control',
        'exfiltration',
        'impact'
    ];
    
    // Maintain engagement context that passes across phase boundaries and subagent lifecycles
    private globalContext: Record<string, any> = {
        discoveredTargets: [],
        activeCredentials: [],
        compromisedHosts: [],
        currentPrimaryTarget: null
    };

    constructor(private agentManager: AgentManager) {}

    getCurrentPhase(): AttackPhase {
        return this.currentPhase;
    }

    advancePhase(): AttackPhase {
        const idx = this.phases.indexOf(this.currentPhase);
        if (idx < this.phases.length - 1) {
            this.currentPhase = this.phases[idx + 1];
            getSessionManager().log('info', `Orchestrator advanced to phase: ${this.currentPhase}`);
        }
        return this.currentPhase;
    }

    setPhase(phase: AttackPhase): void {
        if (this.phases.includes(phase)) {
            this.currentPhase = phase;
            getSessionManager().log('info', `Orchestrator forced phase to: ${this.currentPhase}`);
        }
    }
    
    updateGlobalContext(key: string, data: any): void {
        this.globalContext[key] = data;
    }
    
    getGlobalContext(): Record<string, any> {
        return this.globalContext;
    }

    /**
     * Re-evaluates state based on AttackGraph to auto-adjust the current phase.
     */
    evaluateState(): void {
        const graph = getAttackGraph();
        const nodes = graph.getAllNodes();
        
        let hasCreds = false;
        let hasPayloads = false;
        let hasPivots = false;

        nodes.forEach((n: any) => {
            if (n.type === 'credential') hasCreds = true;
            if (n.type === 'payload') hasPayloads = true;
            if (n.type === 'pivot') hasPivots = true;
        });
        
        // Sync context to graph state
        this.globalContext.activeCredentials = nodes.filter((n: any) => n.type === 'credential');

        // Simple state promotion logic
        if (this.currentPhase === 'recon' && nodes.length > 5) {
            this.setPhase('discovery');
        } else if (this.currentPhase === 'discovery' && hasCreds) {
            this.setPhase('execution');
        } else if (this.currentPhase === 'execution' && hasPayloads) {
            this.setPhase('privilege_escalation');
        } else if (this.currentPhase === 'privilege_escalation' && hasPivots) {
            this.setPhase('lateral_movement');
        }
    }

    /**
     * Returns the recommended next action and which agent should handle it.
     * Incorporates the global context so state isn't lost between agent calls.
     */
    getNextStep(): { action: string; agent: string; contextToPass: any; phase: AttackPhase; prompt: string } {
        this.evaluateState();
        
        // Prepare context payload to pass to the subagent to prevent cold starts
        const contextPayload = {
            currentPhase: this.currentPhase,
            primaryTarget: this.globalContext.currentPrimaryTarget,
            availableCredentials: this.globalContext.activeCredentials.length,
            graphNodeCount: getAttackGraph().getAllNodes().length
        };

        const promptStr = `Execute phase ${this.currentPhase} on target ${this.globalContext.currentPrimaryTarget}.`;
        switch (this.currentPhase) {
            case 'recon':
                return { action: 'Perform active network scanning and OS fingerprinting on target subnets.', agent: 'ReconAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            case 'discovery':
                return { action: 'Enumerate domain controllers, local users, and cloud resources based on recon data.', agent: 'ReconAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            case 'execution':
                return { action: 'Generate and deploy initial access payloads (e.g. reverse shell) against discovered services.', agent: 'PayloadAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            case 'privilege_escalation':
                return { action: 'Audit compromised host for privesc vectors (SUID, Unquoted Paths, Token Privileges) and execute.', agent: 'PhantomAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            case 'defense_evasion':
                return { action: 'Clear logs, timestomp files, and disable security monitoring on the host.', agent: 'PhantomAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            case 'credential_access':
                return { action: 'Dump LSASS memory, SAM hashes, or extract NTDS.dit; perform credential spraying.', agent: 'NyxAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            case 'lateral_movement':
                return { action: 'Use captured credentials or tickets (Pass-the-Hash/Ticket) to pivot to adjacent hosts via SMB/WinRM/SSH.', agent: 'NyxAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            case 'collection':
                return { action: 'Search file system for sensitive documents, keys, and configurations. Archive them.', agent: 'NyxAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            case 'command_and_control':
                return { action: 'Establish persistent covert C2 channels (DNS, HTTPS) to maintain access.', agent: 'PayloadAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            case 'exfiltration':
                return { action: 'Exfiltrate collected archives via HTTP POST, DNS, or ICMP to the C2 server.', agent: 'NyxAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            case 'impact':
                return { action: 'Execute disruption objectives if authorized (service stop, ransomware simulation, recovery inhibition).', agent: 'PhantomAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
            default:
                return { action: 'Standby or generate final report.', agent: 'ReconAgent', contextToPass: contextPayload, phase: this.currentPhase, prompt: promptStr };
        }
    }

    startEngagement(target: string): string {
        this.globalContext.currentPrimaryTarget = target;
        this.setPhase('recon');
        return `Started engagement against ${target}`;
    }

    reportPhaseResult(phase: AttackPhase, success: boolean, resultSummary: string): void {
        getSessionManager().log(success ? 'info' : 'warn', `Phase ${phase} result: ${success ? 'SUCCESS' : 'FAILED'} - ${resultSummary}`);
        if (success) this.advancePhase();
    }

    getStatusReport(): string {
        return `Current Phase: ${this.currentPhase}, Target: ${this.globalContext.currentPrimaryTarget}`;
    }
}

let instance: KillChainOrchestrator | null = null;
export function getKillChainOrchestrator(agentManager: AgentManager): KillChainOrchestrator {
    if (!instance) {
        instance = new KillChainOrchestrator(agentManager);
    }
    return instance;
}

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { getWorkspaceRoot } from '../../tools/PathSecurity.js';
import { SharedContext } from '../agent/SharedContext.js';

export type RiskLevel =
    | 'read'
    | 'local_scan'
    | 'external_scan'
    | 'exploit'
    | 'credential_attack'
    | 'c2'
    | 'destructive';

export type ScopeConfig = {
    localOnly: boolean;
    allowedDomains: string[];
    allowedCidrs: string[];
    blockedTargets: string[];
    allowedOffensiveTools: string[];
};

export type PolicyDecision = {
    allowed: boolean;
    reason: string;
    requiresConfirmation: boolean;
    warning?: string;
};

const DEFAULT_SCOPE: ScopeConfig = {
    localOnly: true,
    allowedDomains: [],
    allowedCidrs: [
        '127.0.0.0/8',
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        '::1/128'
    ],
    blockedTargets: [],
    allowedOffensiveTools: ['nmap_scan', 'port_scan', 'sandbox_execute']
};

function getScopePath(): string {
    const root = getWorkspaceRoot();
    const vertexDir = path.join(root, '.vertex');
    try {
        if (fs.existsSync(vertexDir) && fs.statSync(vertexDir).isDirectory()) {
            return path.join(vertexDir, 'scope.json');
        }
    } catch {
        // Fall back below.
    }
    return path.join(root, '.vertex_plugins', 'scope.json');
}

function normalizeTarget(target: string): string {
    return target.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
}

function parseIpv4(ip: string): number | null {
    if (net.isIP(ip) !== 4) return null;
    return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function ipv4InCidr(ip: string, cidr: string): boolean {
    const [base, bitsRaw] = cidr.split('/');
    const bits = Number(bitsRaw);
    const ipNum = parseIpv4(ip);
    const baseNum = parseIpv4(base);
    if (ipNum === null || baseNum === null || Number.isNaN(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipNum & mask) === (baseNum & mask);
}

function isLocalhost(target: string): boolean {
    const normalized = normalizeTarget(target);
    return normalized === 'localhost' || normalized === '::1' || normalized === '0.0.0.0' || normalized === '127.0.0.1';
}

function isDomainAllowed(target: string, allowedDomains: string[]): boolean {
    const normalized = normalizeTarget(target);
    return allowedDomains.some((domain) => {
        const clean = domain.trim().toLowerCase();
        return clean && (normalized === clean || normalized.endsWith(`.${clean}`));
    });
}

function isTargetBlocked(target: string, blockedTargets: string[]): boolean {
    const normalized = normalizeTarget(target);
    return blockedTargets.some((blocked) => {
        const clean = normalizeTarget(blocked);
        return clean && (normalized === clean || normalized.endsWith(`.${clean}`));
    });
}

function isTargetInCidrScope(target: string, allowedCidrs: string[]): boolean {
    const normalized = normalizeTarget(target);
    if (isLocalhost(normalized)) return true;
    if (net.isIP(normalized) === 4) {
        return allowedCidrs.some((cidr) => ipv4InCidr(normalized, cidr));
    }
    if (net.isIP(normalized) === 6) {
        return normalized === '::1' && allowedCidrs.includes('::1/128');
    }
    return false;
}

export function ensureScopeFile(): string {
    const scopePath = getScopePath();
    if (!fs.existsSync(scopePath)) {
        fs.mkdirSync(path.dirname(scopePath), { recursive: true });
        fs.writeFileSync(scopePath, JSON.stringify(DEFAULT_SCOPE, null, 2), 'utf-8');
    }
    return scopePath;
}

export function loadScope(): ScopeConfig {
    const scopePath = ensureScopeFile();
    try {
        const parsed = JSON.parse(fs.readFileSync(scopePath, 'utf-8')) as Partial<ScopeConfig>;
        return {
            localOnly: parsed.localOnly ?? DEFAULT_SCOPE.localOnly,
            allowedDomains: Array.isArray(parsed.allowedDomains) ? parsed.allowedDomains : DEFAULT_SCOPE.allowedDomains,
            allowedCidrs: Array.isArray(parsed.allowedCidrs) ? parsed.allowedCidrs : DEFAULT_SCOPE.allowedCidrs,
            blockedTargets: Array.isArray(parsed.blockedTargets) ? parsed.blockedTargets : DEFAULT_SCOPE.blockedTargets,
            allowedOffensiveTools: Array.isArray(parsed.allowedOffensiveTools) ? parsed.allowedOffensiveTools : DEFAULT_SCOPE.allowedOffensiveTools
        };
    } catch {
        return DEFAULT_SCOPE;
    }
}

export function describeScope(): string {
    const scopePath = ensureScopeFile();
    const scope = loadScope();
    return [
        `Scope file: ${scopePath}`,
        `Local only: ${scope.localOnly ? 'yes' : 'no'}`,
        `Allowed domains: ${scope.allowedDomains.length ? scope.allowedDomains.join(', ') : '(none)'}`,
        `Allowed CIDRs: ${scope.allowedCidrs.join(', ')}`,
        `Blocked targets: ${scope.blockedTargets.length ? scope.blockedTargets.join(', ') : '(none)'}`,
        `Allowed offensive tools: ${scope.allowedOffensiveTools.join(', ')}`
    ].join('\n');
}

export function isTargetInScope(target: string, scope = loadScope()): boolean {
    if (!target?.trim()) return true;
    if (isTargetBlocked(target, scope.blockedTargets)) return false;
    return isTargetInCidrScope(target, scope.allowedCidrs) || isDomainAllowed(target, scope.allowedDomains);
}

export function isLikelyLocalTarget(target: string): boolean {
    return isTargetInCidrScope(target, DEFAULT_SCOPE.allowedCidrs);
}

export function evaluateToolPolicy(options: {
    toolName: string;
    riskLevel: RiskLevel;
    targets?: string[];
}): PolicyDecision {
    const scope = loadScope();
    const targets = (options.targets || []).map((target) => target.trim()).filter(Boolean);

    for (const target of targets) {
        if (isTargetBlocked(target, scope.blockedTargets)) {
            return {
                allowed: false,
                requiresConfirmation: false,
                reason: `Target is blocked by scope policy: ${target}`
            };
        }
    }

    const outOfScope = targets.filter((target) => !isTargetInScope(target, scope));
    if (scope.localOnly && outOfScope.length > 0) {
        return {
            allowed: false,
            requiresConfirmation: false,
            reason: `Out-of-scope target blocked in local-only mode: ${outOfScope.join(', ')}`
        };
    }

    const offensive = ['exploit', 'credential_attack', 'c2', 'destructive'].includes(options.riskLevel);
    if (offensive && !scope.allowedOffensiveTools.includes(options.toolName)) {
        return {
            allowed: false,
            requiresConfirmation: false,
            reason: `Tool ${options.toolName} is not enabled in allowedOffensiveTools. Add it to the scope file for authorized lab use.`
        };
    }

    return {
        allowed: true,
        requiresConfirmation: options.riskLevel !== 'read',
        reason: 'Allowed by scope policy',
        warning: outOfScope.length ? `Out-of-scope targets detected: ${outOfScope.join(', ')}` : undefined
    };
}

export async function enforceToolPolicy(
    options: {
        toolName: string;
        riskLevel: RiskLevel;
        targets?: string[];
        commandPreview?: string;
        promptLabel?: string;
    },
    requestConfirmation: (msg: string) => Promise<boolean>
): Promise<string | null> {
    const decision = evaluateToolPolicy(options);
    SharedContext.appendAudit({
        event: 'policy_check',
        toolName: options.toolName,
        riskLevel: options.riskLevel,
        targets: options.targets || [],
        allowed: decision.allowed,
        reason: decision.reason
    });

    if (!decision.allowed) {
        return `[POLICY BLOCKED]: ${decision.reason}\nRun /scope show to inspect allowed targets.`;
    }

    if (decision.requiresConfirmation) {
        const targetText = options.targets?.length ? `\nTargets: ${options.targets.join(', ')}` : '';
        const commandText = options.commandPreview ? `\nCommand:\n  > ${options.commandPreview}` : '';
        const warningText = decision.warning ? `\nWarning: ${decision.warning}` : '';
        const approved = await requestConfirmation(
            `[VERTEX POLICY] ${options.promptLabel || options.toolName} requests ${options.riskLevel}.${targetText}${commandText}${warningText}\nAllow? (Y/n)`
        );
        if (!approved) return `[USER OVERRIDE]: ${options.toolName} execution denied.`;
    }

    return null;
}

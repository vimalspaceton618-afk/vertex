import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot } from '../tools/PathSecurity.js';

export type PluginPolicy = {
    autonomyMode?: 'semi_auto' | 'full_auto_lab';
    riskDefaults?: {
        read?: { requireConfirmation?: boolean };
        mutate?: { requireConfirmation?: boolean };
        destructive?: { requireConfirmation?: boolean };
    };
    defaultAllow?: boolean;
    tools?: Record<string, {
        allowed?: boolean;
        requireConfirmation?: boolean;
    }>;
};

const DEFAULT_POLICY: PluginPolicy = {
    autonomyMode: 'semi_auto',
    riskDefaults: {
        read: { requireConfirmation: false },
        mutate: { requireConfirmation: true },
        destructive: { requireConfirmation: true }
    },
    defaultAllow: true,
    tools: {}
};

export function getPluginConfigDir(): string {
    const workspaceRoot = getWorkspaceRoot();
    const legacyRoot = path.join(workspaceRoot, '.vertex');
    if (fs.existsSync(legacyRoot)) {
        try {
            if (fs.statSync(legacyRoot).isDirectory()) {
                return path.join(legacyRoot, 'plugins');
            }
        } catch {
            // fall back
        }
    }
    return path.join(workspaceRoot, '.vertex_plugins');
}

function getPolicyPath(): string {
    return path.join(getPluginConfigDir(), 'policy.json');
}

export function ensurePluginPolicyFile(): void {
    const policyPath = getPolicyPath();
    if (fs.existsSync(policyPath)) return;
    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
    fs.writeFileSync(policyPath, JSON.stringify(DEFAULT_POLICY, null, 2), 'utf-8');
}

function loadPolicy(): PluginPolicy {
    const policyPath = getPolicyPath();
    if (!fs.existsSync(policyPath)) return DEFAULT_POLICY;
    try {
        const parsed = JSON.parse(fs.readFileSync(policyPath, 'utf-8')) as PluginPolicy;
        const mode = (process.env.AUTONOMY_MODE || parsed.autonomyMode || 'semi_auto') as 'semi_auto' | 'full_auto_lab';
        const riskDefaults = mode === 'full_auto_lab'
            ? {
                read: { requireConfirmation: false },
                mutate: { requireConfirmation: false },
                destructive: { requireConfirmation: false }
            }
            : (parsed.riskDefaults || DEFAULT_POLICY.riskDefaults);
        return {
            autonomyMode: mode,
            riskDefaults,
            defaultAllow: parsed.defaultAllow ?? true,
            tools: parsed.tools || {}
        };
    } catch {
        return DEFAULT_POLICY;
    }
}

export function getPolicy(): PluginPolicy {
    return loadPolicy();
}

export function savePolicy(policy: PluginPolicy): void {
    ensurePluginPolicyFile();
    const policyPath = getPolicyPath();
    const normalized: PluginPolicy = {
        autonomyMode: policy.autonomyMode || 'semi_auto',
        riskDefaults: policy.riskDefaults || DEFAULT_POLICY.riskDefaults,
        defaultAllow: policy.defaultAllow ?? true,
        tools: policy.tools || {}
    };
    fs.writeFileSync(policyPath, JSON.stringify(normalized, null, 2), 'utf-8');
}

export function checkToolPolicy(
    toolName: string,
    riskLevel: 'read' | 'mutate' | 'destructive' = 'read'
): { allowed: boolean; requireConfirmation: boolean; autonomyMode: string } {
    const policy = loadPolicy();
    const perTool = policy.tools?.[toolName];
    const allowed = perTool?.allowed ?? (policy.defaultAllow ?? true);
    const defaultRisk = policy.riskDefaults?.[riskLevel]?.requireConfirmation ?? (riskLevel !== 'read');
    const requireConfirmation = perTool?.requireConfirmation ?? defaultRisk;
    return { allowed, requireConfirmation, autonomyMode: policy.autonomyMode || 'semi_auto' };
}

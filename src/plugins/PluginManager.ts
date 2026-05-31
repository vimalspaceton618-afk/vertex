import * as fs from 'fs';
import * as path from 'path';
import { ToolRegistry } from '../tools/registry.js';
import { getWorkspaceRoot } from '../tools/PathSecurity.js';
import { BUILTIN_PLUGIN_MANIFESTS } from './builtinManifests.js';
import { BUILTIN_TOOLSET_FACTORIES } from './builtinTools.js';
import { PluginManifest, PluginRuntime } from './types.js';
import { ensurePluginPolicyFile, getPluginConfigDir } from './policy.js';

function parseCsv(value?: string): Set<string> {
    if (!value) return new Set<string>();
    return new Set(value.split(',').map((x) => x.trim()).filter(Boolean));
}

function isEnabled(manifest: PluginManifest, enabledSet: Set<string>, disabledSet: Set<string>): boolean {
    if (disabledSet.has(manifest.id)) return false;
    if (enabledSet.size > 0) return enabledSet.has(manifest.id);
    return manifest.enabledByDefault !== false;
}

function isSupportedAgent(manifest: PluginManifest, agentName: string): boolean {
    return manifest.supportedAgents.includes(agentName) || manifest.supportedAgents.includes('*');
}

function loadWorkspaceManifests(): PluginManifest[] {
    const manifests: PluginManifest[] = [];
    const pluginDir = getPluginConfigDir();
    const candidateFiles: string[] = [];

    if (fs.existsSync(pluginDir)) {
        const files = fs.readdirSync(pluginDir).filter((x) => x.endsWith('.json'));
        for (const file of files) {
            candidateFiles.push(path.join(pluginDir, file));
        }
    }

    const rootPluginsDir = path.join(getWorkspaceRoot(), 'plugins');
    if (fs.existsSync(rootPluginsDir)) {
        const entries = fs.readdirSync(rootPluginsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const manifestPath = path.join(rootPluginsDir, entry.name, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                candidateFiles.push(manifestPath);
            }
        }
    }

    const seen = new Set<string>();
    for (const fullPath of candidateFiles) {
        if (seen.has(fullPath)) continue;
        seen.add(fullPath);
        try {
            const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as PluginManifest;
            if (!parsed?.id || !parsed?.name || !parsed?.toolsetKey) continue;
            manifests.push({ ...parsed, source: 'workspace' });
        } catch {
            // ignore malformed plugin manifest
        }
    }

    return manifests;
}

export class PluginManager implements PluginRuntime {
    private manifests: PluginManifest[] = [];
    private initialized = false;

    load(): void {
        if (this.initialized) return;
        ensurePluginPolicyFile();
        this.manifests = [
            ...BUILTIN_PLUGIN_MANIFESTS,
            ...loadWorkspaceManifests()
        ];
        this.initialized = true;
    }

    list(): PluginManifest[] {
        this.load();
        return [...this.manifests];
    }

    registerToolsForAgent(agentName: string, registry: ToolRegistry): void {
        this.load();
        const enabledSet = parseCsv(process.env.VERTEX_PLUGINS_ENABLED);
        const disabledSet = parseCsv(process.env.VERTEX_PLUGINS_DISABLED);
        const workspaceRoot = getWorkspaceRoot();

        for (const manifest of this.manifests) {
            if (!isEnabled(manifest, enabledSet, disabledSet)) continue;
            if (!isSupportedAgent(manifest, agentName)) continue;
            const factory = BUILTIN_TOOLSET_FACTORIES[manifest.toolsetKey];
            if (!factory) continue;
            const tools = factory({
                agentName,
                pluginId: manifest.id,
                workspaceRoot
            });
            for (const tool of tools) {
                registry.register(tool);
            }
        }
    }
}

let pluginManagerInstance: PluginManager | null = null;
export function getPluginManager(): PluginManager {
    if (!pluginManagerInstance) pluginManagerInstance = new PluginManager();
    return pluginManagerInstance;
}

import * as path from 'path';

export function getWorkspaceRoot(): string {
    const configured = process.env.VERTEX_WORKSPACE_ROOT?.trim();
    return configured ? path.resolve(configured) : path.resolve(process.cwd());
}

export function resolveInsideWorkspace(targetPath: string): string {
    const root = getWorkspaceRoot();
    const resolved = path.resolve(root, targetPath);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path escapes workspace root: ${targetPath}`);
    }
    return resolved;
}

export function resolveWorkingDirectory(cwd?: string): string {
    if (!cwd) return getWorkspaceRoot();
    return resolveInsideWorkspace(cwd);
}

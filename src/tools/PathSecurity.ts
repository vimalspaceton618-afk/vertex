import * as path from 'path';
import * as fs from 'fs';

export function getWorkspaceRoot(): string {
    const configured = process.env.VERTEX_WORKSPACE_ROOT?.trim();
    const resolved = configured ? path.resolve(configured) : path.resolve(process.cwd());
    try {
        return fs.realpathSync(resolved);
    } catch {
        return resolved;
    }
}

export function resolveInsideWorkspace(targetPath: string): string {
    const root = getWorkspaceRoot();
    const resolved = path.resolve(root, targetPath);

    let realResolved = resolved;
    try {
        if (fs.existsSync(resolved)) {
            realResolved = fs.realpathSync(resolved);
        } else {
            const dir = path.dirname(resolved);
            if (fs.existsSync(dir)) {
                realResolved = path.join(fs.realpathSync(dir), path.basename(resolved));
            }
        }
    } catch {
        // Fall back to resolved if realpath fails
    }

    const rel = path.relative(root, realResolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path escapes workspace root: ${targetPath}`);
    }
    return realResolved;
}

export function resolveWorkingDirectory(cwd?: string): string {
    if (!cwd) return getWorkspaceRoot();
    return resolveInsideWorkspace(cwd);
}


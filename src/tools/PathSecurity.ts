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

    // Resolve the deepest existing ancestor before validating. Checking only the
    // immediate parent misses paths like symlink-to-outside/new-dir/file when
    // the intermediate directory does not exist yet.
    let ancestor = resolved;
    const suffix: string[] = [];
    while (!fs.existsSync(ancestor)) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) {
            throw new Error(`Unable to resolve a safe parent for path: ${targetPath}`);
        }
        suffix.unshift(path.basename(ancestor));
        ancestor = parent;
    }

    const realAncestor = fs.realpathSync(ancestor);
    const realResolved = path.join(realAncestor, ...suffix);
    const rel = path.relative(root, realResolved);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        throw new Error(`Path escapes workspace root: ${targetPath}`);
    }
    return realResolved;
}

export function resolveWorkingDirectory(cwd?: string): string {
    if (!cwd) return getWorkspaceRoot();
    return resolveInsideWorkspace(cwd);
}


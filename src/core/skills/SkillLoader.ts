import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_SKILL_BYTES = 64 * 1024;
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type SkillSummary = {
    name: string;
    path: string;
    bytes: number;
};

/**
 * Read-only Markdown skill discovery. Skill files are treated as untrusted data:
 * this module never imports, evaluates, or executes their contents.
 */
export function getSkillsDirectory(workspaceRoot = process.env.VERTEX_WORKSPACE_ROOT?.trim() || process.cwd()): string {
    return path.join(path.resolve(workspaceRoot), '.vertex', 'skills');
}

export function listWorkspaceSkills(workspaceRoot?: string): SkillSummary[] {
    const directory = getSkillsDirectory(workspaceRoot);
    let entries: fs.Dirent[];
    try {
        const directoryStat = fs.lstatSync(directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return [];
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }

    const skills: SkillSummary[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const name = entry.name.slice(0, -3);
        if (!SKILL_NAME_PATTERN.test(name)) continue;

        const filePath = path.join(directory, entry.name);
        try {
            const stat = fs.lstatSync(filePath);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SKILL_BYTES) continue;
            skills.push({ name, path: filePath, bytes: stat.size });
        } catch {
            // Skip entries that disappear or become inaccessible during discovery.
        }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function readWorkspaceSkill(name: string, workspaceRoot?: string): string {
    if (!SKILL_NAME_PATTERN.test(name)) {
        throw new Error('Invalid skill name. Use lowercase letters, numbers, hyphens, or underscores.');
    }

    const directory = getSkillsDirectory(workspaceRoot);
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        throw new Error('Skills directory must be a real directory, not a symlink.');
    }
    const filePath = path.join(directory, name + '.md');
    const rootReal = fs.realpathSync(directory);
    const realFile = fs.realpathSync(filePath);
    if (path.dirname(realFile) !== rootReal) {
        throw new Error('Skill path escapes the skills directory.');
    }

    // Open without following symlinks where the platform supports O_NOFOLLOW,
    // then verify the opened descriptor to reduce time-of-check/time-of-use risk.
    const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    try {
        const fileStat = fs.fstatSync(fd);
        if (!fileStat.isFile()) {
            throw new Error('Skill must be a regular Markdown file, not a symlink.');
        }
        if (fileStat.size > MAX_SKILL_BYTES) {
            throw new Error(`Skill exceeds the ${MAX_SKILL_BYTES}-byte limit.`);
        }
        return fs.readFileSync(fd, 'utf8');
    } finally {
        fs.closeSync(fd);
    }
}

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

const LOOT_DIR = path.join(os.homedir(), '.vertex', 'loot');
const VAULT_FILE = path.join(LOOT_DIR, 'vault.enc');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export type CredentialEntry = {
    id: string;
    target: string;
    username: string;
    password?: string;
    domain?: string;
    source: string;
    addedAt: string;
};

export type HashEntry = {
    id: string;
    target: string;
    username: string;
    hash: string;
    hashType: 'ntlm' | 'ntlmv2' | 'md5' | 'sha256' | 'sha512' | 'bcrypt' | 'kerberos' | 'netntlmv2' | 'other';
    cracked?: string;
    source: string;
    addedAt: string;
};

export type TokenEntry = {
    id: string;
    target: string;
    tokenType: 'bearer' | 'jwt' | 'api_key' | 'cookie' | 'session' | 'kerberos_tgt' | 'kerberos_tgs' | 'oauth' | 'other';
    token: string;
    expiresAt?: string;
    source: string;
    addedAt: string;
};

export type SessionEntry = {
    id: string;
    target: string;
    sessionType: 'meterpreter' | 'shell' | 'ssh' | 'rdp' | 'winrm' | 'smb' | 'sliver' | 'beacon' | 'other';
    connectionInfo: string;
    status: 'active' | 'dormant' | 'dead';
    establishedAt: string;
    lastSeenAt: string;
};

export type LootVault = {
    credentials: CredentialEntry[];
    hashes: HashEntry[];
    tokens: TokenEntry[];
    sessions: SessionEntry[];
    metadata: {
        createdAt: string;
        lastModified: string;
        entryCount: number;
    };
};

function genId(): string {
    return crypto.randomBytes(8).toString('hex');
}

function compositeKey(type: string, target: string, username: string, extra?: string): string {
    return `${type}::${target}::${username}::${extra || ''}`.toLowerCase();
}

function deriveKey(): Buffer {
    const machineId = os.hostname() + os.userInfo().username;
    const salt = crypto.createHash('sha256').update('vertex-loot-salt-v1').digest();
    return crypto.pbkdf2Sync(machineId, salt, 100000, KEY_LENGTH, 'sha512');
}

function encrypt(data: string): Buffer {
    const key = deriveKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(data: Buffer): string {
    const key = deriveKey();
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted, undefined, 'utf-8') + decipher.final('utf-8');
}

function ensureDir(): void {
    if (!fs.existsSync(LOOT_DIR)) {
        fs.mkdirSync(LOOT_DIR, { recursive: true, mode: 0o700 });
    }
}

function emptyVault(): LootVault {
    return {
        credentials: [],
        hashes: [],
        tokens: [],
        sessions: [],
        metadata: {
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            entryCount: 0
        }
    };
}

export class LootStore {
    private vault: LootVault;
    private dedup = new Set<string>();

    constructor() {
        this.vault = this.load();
        this.rebuildDedup();
    }

    private load(): LootVault {
        ensureDir();
        if (!fs.existsSync(VAULT_FILE)) return emptyVault();
        try {
            const raw = fs.readFileSync(VAULT_FILE);
            const json = decrypt(raw);
            return JSON.parse(json) as LootVault;
        } catch {
            return emptyVault();
        }
    }

    private save(): void {
        ensureDir();
        this.vault.metadata.lastModified = new Date().toISOString();
        this.vault.metadata.entryCount =
            this.vault.credentials.length +
            this.vault.hashes.length +
            this.vault.tokens.length +
            this.vault.sessions.length;
        const json = JSON.stringify(this.vault, null, 2);
        const encrypted = encrypt(json);
        fs.writeFileSync(VAULT_FILE, encrypted, { mode: 0o600 });
    }

    private rebuildDedup(): void {
        this.dedup.clear();
        for (const c of this.vault.credentials) this.dedup.add(compositeKey('cred', c.target, c.username));
        for (const h of this.vault.hashes) this.dedup.add(compositeKey('hash', h.target, h.username, h.hash));
        for (const t of this.vault.tokens) this.dedup.add(compositeKey('token', t.target, t.tokenType, t.token.slice(0, 16)));
    }

    addCred(entry: Omit<CredentialEntry, 'id' | 'addedAt'>): string {
        const key = compositeKey('cred', entry.target, entry.username);
        if (this.dedup.has(key)) return 'duplicate';
        const full: CredentialEntry = { ...entry, id: genId(), addedAt: new Date().toISOString() };
        this.vault.credentials.push(full);
        this.dedup.add(key);
        this.save();
        return full.id;
    }

    addHash(entry: Omit<HashEntry, 'id' | 'addedAt'>): string {
        const key = compositeKey('hash', entry.target, entry.username, entry.hash);
        if (this.dedup.has(key)) return 'duplicate';
        const full: HashEntry = { ...entry, id: genId(), addedAt: new Date().toISOString() };
        this.vault.hashes.push(full);
        this.dedup.add(key);
        this.save();
        return full.id;
    }

    addToken(entry: Omit<TokenEntry, 'id' | 'addedAt'>): string {
        const key = compositeKey('token', entry.target, entry.tokenType, entry.token.slice(0, 16));
        if (this.dedup.has(key)) return 'duplicate';
        const full: TokenEntry = { ...entry, id: genId(), addedAt: new Date().toISOString() };
        this.vault.tokens.push(full);
        this.dedup.add(key);
        this.save();
        return full.id;
    }

    addSession(entry: Omit<SessionEntry, 'id'>): string {
        const full: SessionEntry = { ...entry, id: genId() };
        this.vault.sessions.push(full);
        this.save();
        return full.id;
    }

    updateSessionStatus(id: string, status: SessionEntry['status']): boolean {
        const session = this.vault.sessions.find(s => s.id === id);
        if (!session) return false;
        session.status = status;
        session.lastSeenAt = new Date().toISOString();
        this.save();
        return true;
    }

    markHashCracked(id: string, plaintext: string): boolean {
        const hash = this.vault.hashes.find(h => h.id === id);
        if (!hash) return false;
        hash.cracked = plaintext;
        this.save();
        return true;
    }

    query(filter?: { target?: string; username?: string; type?: string }): string {
        const results: string[] = ['[LOOT STORE QUERY]'];
        const matchTarget = (t: string) => !filter?.target || t.toLowerCase().includes(filter.target.toLowerCase());
        const matchUser = (u: string) => !filter?.username || u.toLowerCase().includes(filter.username.toLowerCase());

        const creds = this.vault.credentials.filter(c => matchTarget(c.target) && matchUser(c.username));
        const hashes = this.vault.hashes.filter(h => matchTarget(h.target) && matchUser(h.username));
        const tokens = this.vault.tokens.filter(t => matchTarget(t.target));
        const sessions = this.vault.sessions.filter(s => matchTarget(s.target));

        if (creds.length) {
            results.push(`\nCredentials (${creds.length}):`);
            for (const c of creds) results.push(`  ${c.target} | ${c.domain ? c.domain + '\\\\' : ''}${c.username} | ${c.password ? '***' : 'no-pass'} | src: ${c.source}`);
        }
        if (hashes.length) {
            results.push(`\nHashes (${hashes.length}):`);
            for (const h of hashes) results.push(`  ${h.target} | ${h.username} | ${h.hashType} | ${h.cracked ? 'CRACKED' : 'uncracked'} | src: ${h.source}`);
        }
        if (tokens.length) {
            results.push(`\nTokens (${tokens.length}):`);
            for (const t of tokens) results.push(`  ${t.target} | ${t.tokenType} | ${t.token.slice(0, 12)}... | src: ${t.source}`);
        }
        if (sessions.length) {
            results.push(`\nSessions (${sessions.length}):`);
            for (const s of sessions) results.push(`  ${s.target} | ${s.sessionType} | ${s.status} | since: ${s.establishedAt}`);
        }

        if (creds.length + hashes.length + tokens.length + sessions.length === 0) {
            results.push('No matching loot entries found.');
        }

        results.push(`\nVault total: ${this.vault.metadata.entryCount} entries`);
        return results.join('\n');
    }

    exportJson(): string {
        return JSON.stringify(this.vault, null, 2);
    }

    exportHashcat(): string {
        return this.vault.hashes.map(h => `${h.username}:${h.hash}`).join('\n');
    }

    getStats(): string {
        return [
            `[LOOT STORE STATS]`,
            `Credentials: ${this.vault.credentials.length}`,
            `Hashes: ${this.vault.hashes.length} (${this.vault.hashes.filter(h => h.cracked).length} cracked)`,
            `Tokens: ${this.vault.tokens.length}`,
            `Sessions: ${this.vault.sessions.length} (${this.vault.sessions.filter(s => s.status === 'active').length} active)`,
            `Last modified: ${this.vault.metadata.lastModified}`
        ].join('\n');
    }

    destroy(): void {
        if (fs.existsSync(VAULT_FILE)) {
            const size = fs.statSync(VAULT_FILE).size;
            fs.writeFileSync(VAULT_FILE, crypto.randomBytes(size), { mode: 0o600 });
            fs.unlinkSync(VAULT_FILE);
        }
        this.vault = emptyVault();
        this.dedup.clear();
    }
}

let instance: LootStore | null = null;
export function getLootStore(): LootStore {
    if (!instance) instance = new LootStore();
    return instance;
}

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

export class ConfigManager {
    static globalConfigPath = path.join(os.homedir(), '.vertexcli', 'config.json');
    static defaultConfig() {
        return {
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
            OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "",
            BRAIN_MODE: process.env.BRAIN_MODE || "cloud",
            BRAIN_ROUTING_MAP: process.env.BRAIN_ROUTING_MAP || "",
            LOCAL_BASE_URL: process.env.LOCAL_BASE_URL || "http://127.0.0.1:11434/v1",
            LOCAL_API_KEY: process.env.LOCAL_API_KEY || "local-key",
            AI_MODEL: process.env.AI_MODEL || "",
            AI_MODEL_PLAN: process.env.AI_MODEL_PLAN || "",
            AI_MODEL_CODE: process.env.AI_MODEL_CODE || "",
            AI_MODEL_FAST: process.env.AI_MODEL_FAST || "",
            LOCAL_MODEL: process.env.LOCAL_MODEL || "",
            LOCAL_MODEL_PLAN: process.env.LOCAL_MODEL_PLAN || "",
            LOCAL_MODEL_CODE: process.env.LOCAL_MODEL_CODE || "",
            LOCAL_MODEL_FAST: process.env.LOCAL_MODEL_FAST || "",
            AUTONOMY_MODE: process.env.AUTONOMY_MODE || "semi_auto",
            AUTO_LOOP_MAX_ITERATIONS: process.env.AUTO_LOOP_MAX_ITERATIONS || "8",
            AUTO_LOOP_MAX_DURATION_MS: process.env.AUTO_LOOP_MAX_DURATION_MS || "120000",
            SHELL_TIMEOUT_MS: process.env.SHELL_TIMEOUT_MS || "60000",
            SHELL_MAX_OUTPUT_BYTES: process.env.SHELL_MAX_OUTPUT_BYTES || "16000",
            COMMAND_ALLOWLIST: process.env.COMMAND_ALLOWLIST || "",
            COMMAND_DENYLIST: process.env.COMMAND_DENYLIST || "",
            WORKSPACE_ROOT: process.env.WORKSPACE_ROOT || "",
            PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || "",
            VERTEX_PLUGINS_ENABLED: process.env.VERTEX_PLUGINS_ENABLED || "",
            VERTEX_PLUGINS_DISABLED: process.env.VERTEX_PLUGINS_DISABLED || ""
        };
    }

    static init() {
        // 1. Load local .env if the user is explicitly developing VERTEX
        dotenv.config();

        // 2. Ensure global OS directory securely exists
        const dir = path.dirname(this.globalConfigPath);
        if (!fs.existsSync(dir)) {
            // mode 0o700 ensures ONLY the current user can read/write this directory
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); 
        }
        
        // 3. Initialize config.json if it doesn't exist
        if (!fs.existsSync(this.globalConfigPath)) {
            fs.writeFileSync(this.globalConfigPath, JSON.stringify(this.defaultConfig(), null, 2), { mode: 0o600 }); // strict permissions
        } else {
            try {
                const current = JSON.parse(fs.readFileSync(this.globalConfigPath, 'utf-8'));
                const merged = { ...this.defaultConfig(), ...current };
                fs.writeFileSync(this.globalConfigPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
            } catch {
                // Keep existing file if parsing fails
            }
        }

        // 4. Overwrite run-time environment variables with global config state
        try {
            const data = JSON.parse(fs.readFileSync(this.globalConfigPath, 'utf-8'));
            if (data.OPENAI_API_KEY && data.OPENAI_API_KEY.trim() !== '') {
                process.env.OPENAI_API_KEY = data.OPENAI_API_KEY;
            }
            if (data.OPENAI_BASE_URL && data.OPENAI_BASE_URL.trim() !== '') {
                process.env.OPENAI_BASE_URL = data.OPENAI_BASE_URL;
            }
            if (data.BRAIN_MODE && data.BRAIN_MODE.trim() !== '') {
                process.env.BRAIN_MODE = data.BRAIN_MODE;
            }
            if (typeof data.BRAIN_ROUTING_MAP === 'string') {
                process.env.BRAIN_ROUTING_MAP = data.BRAIN_ROUTING_MAP;
            }
            if (data.LOCAL_BASE_URL && data.LOCAL_BASE_URL.trim() !== '') {
                process.env.LOCAL_BASE_URL = data.LOCAL_BASE_URL;
            }
            if (data.LOCAL_API_KEY && data.LOCAL_API_KEY.trim() !== '') {
                process.env.LOCAL_API_KEY = data.LOCAL_API_KEY;
            }
            if (data.AI_MODEL && data.AI_MODEL.trim() !== '') {
                process.env.AI_MODEL = data.AI_MODEL;
            }
            if (data.AI_MODEL_PLAN && data.AI_MODEL_PLAN.trim() !== '') {
                process.env.AI_MODEL_PLAN = data.AI_MODEL_PLAN;
            }
            if (data.AI_MODEL_CODE && data.AI_MODEL_CODE.trim() !== '') {
                process.env.AI_MODEL_CODE = data.AI_MODEL_CODE;
            }
            if (data.AI_MODEL_FAST && data.AI_MODEL_FAST.trim() !== '') {
                process.env.AI_MODEL_FAST = data.AI_MODEL_FAST;
            }
            if (data.LOCAL_MODEL && data.LOCAL_MODEL.trim() !== '') {
                process.env.LOCAL_MODEL = data.LOCAL_MODEL;
            }
            if (data.LOCAL_MODEL_PLAN && data.LOCAL_MODEL_PLAN.trim() !== '') {
                process.env.LOCAL_MODEL_PLAN = data.LOCAL_MODEL_PLAN;
            }
            if (data.LOCAL_MODEL_CODE && data.LOCAL_MODEL_CODE.trim() !== '') {
                process.env.LOCAL_MODEL_CODE = data.LOCAL_MODEL_CODE;
            }
            if (data.LOCAL_MODEL_FAST && data.LOCAL_MODEL_FAST.trim() !== '') {
                process.env.LOCAL_MODEL_FAST = data.LOCAL_MODEL_FAST;
            }
            if (data.AUTONOMY_MODE && data.AUTONOMY_MODE.trim() !== '') {
                process.env.AUTONOMY_MODE = data.AUTONOMY_MODE;
            }
            if (data.AUTO_LOOP_MAX_ITERATIONS && data.AUTO_LOOP_MAX_ITERATIONS.toString().trim() !== '') {
                process.env.AUTO_LOOP_MAX_ITERATIONS = data.AUTO_LOOP_MAX_ITERATIONS.toString();
            }
            if (data.AUTO_LOOP_MAX_DURATION_MS && data.AUTO_LOOP_MAX_DURATION_MS.toString().trim() !== '') {
                process.env.AUTO_LOOP_MAX_DURATION_MS = data.AUTO_LOOP_MAX_DURATION_MS.toString();
            }
            if (data.SHELL_TIMEOUT_MS && data.SHELL_TIMEOUT_MS.toString().trim() !== '') {
                process.env.SHELL_TIMEOUT_MS = data.SHELL_TIMEOUT_MS.toString();
            }
            if (data.SHELL_MAX_OUTPUT_BYTES && data.SHELL_MAX_OUTPUT_BYTES.toString().trim() !== '') {
                process.env.SHELL_MAX_OUTPUT_BYTES = data.SHELL_MAX_OUTPUT_BYTES.toString();
            }
            if (typeof data.COMMAND_ALLOWLIST === 'string') {
                process.env.COMMAND_ALLOWLIST = data.COMMAND_ALLOWLIST;
            }
            if (typeof data.COMMAND_DENYLIST === 'string') {
                process.env.COMMAND_DENYLIST = data.COMMAND_DENYLIST;
            }
            if (data.WORKSPACE_ROOT && data.WORKSPACE_ROOT.trim() !== '') {
                process.env.VERTEX_WORKSPACE_ROOT = data.WORKSPACE_ROOT.trim();
            }
            if (data.PUPPETEER_EXECUTABLE_PATH && data.PUPPETEER_EXECUTABLE_PATH.trim() !== '') {
                process.env.PUPPETEER_EXECUTABLE_PATH = data.PUPPETEER_EXECUTABLE_PATH.trim();
            }
            if (typeof data.VERTEX_PLUGINS_ENABLED === 'string') {
                process.env.VERTEX_PLUGINS_ENABLED = data.VERTEX_PLUGINS_ENABLED;
            }
            if (typeof data.VERTEX_PLUGINS_DISABLED === 'string') {
                process.env.VERTEX_PLUGINS_DISABLED = data.VERTEX_PLUGINS_DISABLED;
            }
        } catch (e) {
            // Silently fallback to standard env
        }
    }
}

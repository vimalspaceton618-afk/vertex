import * as fs from 'fs';
import { execSync } from 'child_process';

export type HealthStatus = {
  workspaceRoot: string;
  brainMode: string;
  llmKeyConfigured: boolean;
  baseUrlConfigured: boolean;
  localBaseUrlConfigured: boolean;
  localApiKeyConfigured: boolean;
  modelRouting: {
    base: string;
    plan: string;
    code: string;
  };
  localModelRouting: {
    base: string;
    plan: string;
    code: string;
  };
  brainRoutingMapConfigured: boolean;
  brainRoutingMapPreview: string;
  hybridRoutingPolicy: string;
  shellPolicy: {
    timeoutMs: string;
    maxOutputBytes: string;
  };
  gitAvailable: boolean;
  ripgrepAvailable: boolean;
  browserRuntimeAvailable: boolean;
  puppeteerExecutableOverride: string;
};

function checkBinary(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectBrowserRuntime(overridePath: string): boolean {
  if (overridePath) {
    return fs.existsSync(overridePath);
  }
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.some((p) => fs.existsSync(p));
}

export function collectHealthStatus(): HealthStatus {
  const workspaceRoot = process.env.VERTEX_WORKSPACE_ROOT || process.cwd();
  const puppeteerExecutableOverride = process.env.PUPPETEER_EXECUTABLE_PATH || '';
  return {
    workspaceRoot,
    brainMode: process.env.BRAIN_MODE || 'cloud',
    llmKeyConfigured: Boolean((process.env.OPENAI_API_KEY || '').trim()),
    baseUrlConfigured: Boolean((process.env.OPENAI_BASE_URL || '').trim()),
    localBaseUrlConfigured: Boolean((process.env.LOCAL_BASE_URL || '').trim()),
    localApiKeyConfigured: Boolean((process.env.LOCAL_API_KEY || '').trim()),
    modelRouting: {
      base: process.env.AI_MODEL || '(default)',
      plan: process.env.AI_MODEL_PLAN || '(inherits)',
      code: process.env.AI_MODEL_CODE || '(inherits)'
    },
    localModelRouting: {
      base: process.env.LOCAL_MODEL || '(fallback to cloud model)',
      plan: process.env.LOCAL_MODEL_PLAN || '(inherits)',
      code: process.env.LOCAL_MODEL_CODE || '(inherits)'
    },
    brainRoutingMapConfigured: Boolean((process.env.BRAIN_ROUTING_MAP || '').trim()),
    brainRoutingMapPreview: (process.env.BRAIN_ROUTING_MAP || '').trim() || '(not configured)',
    hybridRoutingPolicy: 'Plan/Explore=local-first, Developer/Browser/DevOps=cloud-first, others=local-first',
    shellPolicy: {
      timeoutMs: process.env.SHELL_TIMEOUT_MS || '60000',
      maxOutputBytes: process.env.SHELL_MAX_OUTPUT_BYTES || '16000'
    },
    gitAvailable: checkBinary('git --version'),
    ripgrepAvailable: checkBinary('rg --version'),
    browserRuntimeAvailable: detectBrowserRuntime(puppeteerExecutableOverride),
    puppeteerExecutableOverride: puppeteerExecutableOverride || '(auto-detect)'
  };
}

export function formatHealthReport(status: HealthStatus): string {
  return [
    'VERTEX Health Check',
    `- Workspace root: ${status.workspaceRoot}`,
    `- Brain mode: ${status.brainMode}`,
    `- LLM key configured: ${status.llmKeyConfigured ? 'yes' : 'no'}`,
    `- Base URL configured: ${status.baseUrlConfigured ? 'yes' : 'no'}`,
    `- Local base URL configured: ${status.localBaseUrlConfigured ? 'yes' : 'no'}`,
    `- Local API key configured: ${status.localApiKeyConfigured ? 'yes' : 'no'}`,
    `- Model routing: base=${status.modelRouting.base}, plan=${status.modelRouting.plan}, code=${status.modelRouting.code}`,
    `- Local model routing: base=${status.localModelRouting.base}, plan=${status.localModelRouting.plan}, code=${status.localModelRouting.code}`,
    `- Routing map configured: ${status.brainRoutingMapConfigured ? 'yes' : 'no'}`,
    `- Routing map preview: ${status.brainRoutingMapPreview}`,
    `- Hybrid policy: ${status.hybridRoutingPolicy}`,
    `- Shell policy: timeout=${status.shellPolicy.timeoutMs}ms, maxOutput=${status.shellPolicy.maxOutputBytes}`,
    `- Git available: ${status.gitAvailable ? 'yes' : 'no'}`,
    `- Ripgrep available: ${status.ripgrepAvailable ? 'yes' : 'no'}`,
    `- Browser runtime available: ${status.browserRuntimeAvailable ? 'yes' : 'no'}`,
    `- Puppeteer executable override: ${status.puppeteerExecutableOverride}`
  ].join('\n');
}

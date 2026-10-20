import { Tool } from './Tool.js';
import { SharedContext } from '../core/agent/SharedContext.js';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Encode arbitrary data as a GraphQL string literal (JSON string escapes are GraphQL-compatible). */
export function toGraphQLStringLiteral(value: unknown): string {
    return JSON.stringify(String(value));
}

// ---------------------------------------------------------------------------
// Provider Abstraction
// ---------------------------------------------------------------------------

interface GpuProvider {
    name: string;
    provision(config: JobConfig): Promise<InstanceHandle>;
    destroy(handle: InstanceHandle): Promise<string>;
    status(handle: InstanceHandle): Promise<InstanceStatus>;
    streamLogs(handle: InstanceHandle): AsyncGenerator<string, void, unknown>;
    listGpus(): Promise<GpuOffering[]>;
}

interface JobConfig {
    script: string;
    gpuModel: string;
    diskGb: number;
    image: string;
    env: Record<string, string>;
    args: string[];
    volumeMounts: string[];
    ports: number[];
    maxRuntimeMin: number;
}

interface InstanceHandle {
    provider: string;
    instanceId: string;
    ip?: string;
    sshPort?: number;
    apiEndpoint?: string;
}

interface InstanceStatus {
    state: 'provisioning' | 'running' | 'completed' | 'failed' | 'terminated';
    uptimeSeconds: number;
    gpuUtilization?: number;
    memoryUsedMb?: number;
    cost?: number;
    logs?: string;
}

interface GpuOffering {
    model: string;
    vram: string;
    pricePerHour: number;
    available: boolean;
}

// ---------------------------------------------------------------------------
// State persistence — tracks all active instances across sessions
// ---------------------------------------------------------------------------

const STATE_DIR = path.join(os.homedir(), '.vertex', 'gpu_jobs');

function ensureStateDir() {
    if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    }
}

function saveJob(handle: InstanceHandle, config: JobConfig) {
    ensureStateDir();
    const record = { handle, config, startedAt: new Date().toISOString() };
    fs.writeFileSync(
        path.join(STATE_DIR, `${handle.instanceId}.json`),
        JSON.stringify(record, null, 2),
        { mode: 0o600 }
    );
}

function loadJobs(): Array<{ handle: InstanceHandle; config: JobConfig; startedAt: string }> {
    ensureStateDir();
    const files = fs.readdirSync(STATE_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
        try {
            return JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf-8'));
        } catch {
            return null;
        }
    }).filter(Boolean);
}

function removeJob(instanceId: string) {
    const fp = path.join(STATE_DIR, `${instanceId}.json`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

// ---------------------------------------------------------------------------
// RunPod Provider
// ---------------------------------------------------------------------------

class RunPodProvider implements GpuProvider {
    name = 'runpod';

    private get apiKey(): string {
        return process.env.RUNPOD_API_KEY || '';
    }

    private get baseUrl(): string {
        return 'https://api.runpod.io/v2';
    }

    private async apiCall(endpoint: string, method = 'GET', body?: any): Promise<any> {
        if (!this.apiKey) throw new Error('RUNPOD_API_KEY not set. Export it in your environment.');
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
        const opts: RequestInit = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`${this.baseUrl}${endpoint}`, opts);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`RunPod API ${res.status}: ${text}`);
        }
        return res.json();
    }

    private async graphql(query: string, variables?: any): Promise<any> {
        if (!this.apiKey) throw new Error('RUNPOD_API_KEY not set.');
        const res = await fetch('https://api.runpod.io/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({ query, variables })
        });
        if (!res.ok) throw new Error(`RunPod GraphQL ${res.status}: ${await res.text()}`);
        return res.json();
    }

    async provision(config: JobConfig): Promise<InstanceHandle> {
        // These values are interpolated as GraphQL numeric literals; reject invalid
        // runtime inputs rather than relying on TypeScript types at the API boundary.
        if (!Number.isInteger(config.diskGb) || config.diskGb < 1 || config.diskGb > 10000) {
            throw new Error('diskGb must be an integer between 1 and 10000.');
        }
        if (!Array.isArray(config.ports) || config.ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
            throw new Error('ports must be an array of integers between 1 and 65535.');
        }
        if (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== 'string')) {
            throw new Error('args must be an array of strings.');
        }
        if (!config.env || typeof config.env !== 'object' || Array.isArray(config.env) ||
            Object.entries(config.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string')) {
            throw new Error('env must contain valid environment variable names and string values.');
        }

        const gpuMap: Record<string, string> = {
            'a100': 'NVIDIA A100 80GB PCIe',
            'a100-80': 'NVIDIA A100 80GB PCIe',
            'a100-40': 'NVIDIA A100-SXM4-40GB',
            'h100': 'NVIDIA H100 80GB HBM3',
            'a40': 'NVIDIA A40',
            'rtx4090': 'NVIDIA GeForce RTX 4090',
            'rtx3090': 'NVIDIA GeForce RTX 3090',
            'l40': 'NVIDIA L40',
            'l40s': 'NVIDIA L40S',
            'a6000': 'NVIDIA RTX A6000',
            '4090': 'NVIDIA GeForce RTX 4090',
            '3090': 'NVIDIA GeForce RTX 3090',
        };

        const gpuTypeId = gpuMap[config.gpuModel.toLowerCase()] || config.gpuModel;

        const envVars: Record<string, string> = {
            ...config.env,
            VERTEX_SCRIPT: config.script,
            VERTEX_ARGS: config.args.join(' ')
        };

        const envArray = Object.entries(envVars).map(([key, value]) => ({ key, value }));

        const mutation = `
            mutation {
                podFindAndDeployOnDemand(input: {
                    name: ${toGraphQLStringLiteral(`vertex-gpu-${Date.now()}`)}
                    imageName: ${toGraphQLStringLiteral(config.image)}
                    gpuTypeId: ${toGraphQLStringLiteral(gpuTypeId)}
                    gpuCount: 1
                    volumeInGb: ${config.diskGb}
                    containerDiskInGb: ${Math.max(20, config.diskGb)}
                    minVcpuCount: 4
                    minMemoryInGb: 16
                    ports: ${toGraphQLStringLiteral(config.ports.map(p => `${p}/http`).join(','))}
                    env: [${envArray.map(e => `{key: ${toGraphQLStringLiteral(e.key)}, value: ${toGraphQLStringLiteral(e.value)}}`).join(',')}]
                    dockerArgs: ${toGraphQLStringLiteral(config.args.join(' '))}
                }) {
                    id
                    imageName
                    machine { podHostId }
                    desiredStatus
                    costPerHr
                }
            }
        `;

        const result = await this.graphql(mutation);
        const pod = result?.data?.podFindAndDeployOnDemand;
        if (!pod?.id) throw new Error(`Failed to provision RunPod instance: ${JSON.stringify(result)}`);

        return {
            provider: 'runpod',
            instanceId: pod.id,
            apiEndpoint: `https://api.runpod.io/v2/${pod.id}`
        };
    }

    async destroy(handle: InstanceHandle): Promise<string> {
        const mutation = `
            mutation {
                podTerminate(input: { podId: ${toGraphQLStringLiteral(handle.instanceId)} })
            }
        `;
        await this.graphql(mutation);
        removeJob(handle.instanceId);
        return `Instance ${handle.instanceId} terminated.`;
    }

    async status(handle: InstanceHandle): Promise<InstanceStatus> {
        const query = `
            query {
                pod(input: { podId: ${toGraphQLStringLiteral(handle.instanceId)} }) {
                    id
                    desiredStatus
                    runtime { uptimeInSeconds gpus { gpuUtilPerc memoryUtilPerc } }
                    costPerHr
                }
            }
        `;
        const result = await this.graphql(query);
        const pod = result?.data?.pod;
        if (!pod) throw new Error(`Pod ${handle.instanceId} not found.`);

        const stateMap: Record<string, InstanceStatus['state']> = {
            'RUNNING': 'running',
            'CREATED': 'provisioning',
            'EXITED': 'completed',
            'TERMINATED': 'terminated',
        };

        return {
            state: stateMap[pod.desiredStatus] || 'running',
            uptimeSeconds: pod.runtime?.uptimeInSeconds || 0,
            gpuUtilization: pod.runtime?.gpus?.[0]?.gpuUtilPerc,
            memoryUsedMb: pod.runtime?.gpus?.[0]?.memoryUtilPerc,
            cost: pod.costPerHr
        };
    }

    async *streamLogs(handle: InstanceHandle): AsyncGenerator<string, void, unknown> {
        const query = `
            query {
                pod(input: { podId: "${handle.instanceId}" }) {
                    runtime { logs }
                }
            }
        `;
        const result = await this.graphql(query);
        const logs = result?.data?.pod?.runtime?.logs || 'No logs available yet.';
        yield logs;
    }

    async listGpus(): Promise<GpuOffering[]> {
        const query = `
            query {
                gpuTypes {
                    id
                    displayName
                    memoryInGb
                    communityPrice
                    securePrice
                    communitySpotPrice
                    secureSpotPrice
                }
            }
        `;
        const result = await this.graphql(query);
        const types = result?.data?.gpuTypes || [];
        return types.map((g: any) => ({
            model: g.displayName || g.id,
            vram: `${g.memoryInGb}GB`,
            pricePerHour: g.communityPrice || g.securePrice || 0,
            available: true
        }));
    }
}

// ---------------------------------------------------------------------------
// Lambda Labs Provider
// ---------------------------------------------------------------------------

class LambdaProvider implements GpuProvider {
    name = 'lambda';

    private get apiKey(): string {
        return process.env.LAMBDA_API_KEY || '';
    }

    private async apiCall(endpoint: string, method = 'GET', body?: any): Promise<any> {
        if (!this.apiKey) throw new Error('LAMBDA_API_KEY not set.');
        const headers: Record<string, string> = {
            'Authorization': `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
            'Content-Type': 'application/json'
        };
        const opts: RequestInit = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`https://cloud.lambdalabs.com/api/v1${endpoint}`, opts);
        if (!res.ok) throw new Error(`Lambda API ${res.status}: ${await res.text()}`);
        return res.json();
    }

    async provision(config: JobConfig): Promise<InstanceHandle> {
        const gpuMap: Record<string, string> = {
            'a100': 'gpu_1x_a100',
            'a100-80': 'gpu_1x_a100_sxm4',
            'h100': 'gpu_1x_h100_pcie',
            'a10': 'gpu_1x_a10',
            '8xa100': 'gpu_8x_a100_80gb_sxm4',
        };

        const instanceType = gpuMap[config.gpuModel.toLowerCase()] || `gpu_1x_${config.gpuModel.toLowerCase()}`;

        const sshKeys = await this.apiCall('/ssh-keys');
        const keyNames = sshKeys?.data?.map((k: any) => k.name) || [];

        const result = await this.apiCall('/instance-operations/launch', 'POST', {
            region_name: 'us-east-1',
            instance_type_name: instanceType,
            ssh_key_names: keyNames.slice(0, 1),
            name: `vertex-gpu-${Date.now()}`,
            file_system_names: []
        });

        const instances = result?.data?.instance_ids || [];
        if (instances.length === 0) throw new Error(`Lambda launch failed: ${JSON.stringify(result)}`);

        return {
            provider: 'lambda',
            instanceId: instances[0],
            sshPort: 22
        };
    }

    async destroy(handle: InstanceHandle): Promise<string> {
        await this.apiCall('/instance-operations/terminate', 'POST', {
            instance_ids: [handle.instanceId]
        });
        removeJob(handle.instanceId);
        return `Instance ${handle.instanceId} terminated.`;
    }

    async status(handle: InstanceHandle): Promise<InstanceStatus> {
        const result = await this.apiCall(`/instances/${handle.instanceId}`);
        const inst = result?.data;
        if (!inst) throw new Error(`Instance ${handle.instanceId} not found.`);

        const stateMap: Record<string, InstanceStatus['state']> = {
            'active': 'running',
            'booting': 'provisioning',
            'terminated': 'terminated',
            'unhealthy': 'failed',
        };

        return {
            state: stateMap[inst.status] || 'running',
            uptimeSeconds: 0,
            cost: inst.instance_type?.price_cents_per_hour ? inst.instance_type.price_cents_per_hour / 100 : undefined
        };
    }

    async *streamLogs(handle: InstanceHandle): AsyncGenerator<string, void, unknown> {
        yield `Lambda instances use SSH for log access.\nConnect: ssh ubuntu@${handle.ip || handle.instanceId} -p ${handle.sshPort || 22}`;
    }

    async listGpus(): Promise<GpuOffering[]> {
        const result = await this.apiCall('/instance-types');
        const types = result?.data || {};
        return Object.entries(types).map(([key, val]: [string, any]) => ({
            model: val.instance_type?.description || key,
            vram: `${val.instance_type?.specs?.gpus?.[0]?.vram_gib || '?'}GB`,
            pricePerHour: (val.instance_type?.price_cents_per_hour || 0) / 100,
            available: (val.regions_with_capacity_available || []).length > 0
        }));
    }
}

// ---------------------------------------------------------------------------
// Vast.ai Provider
// ---------------------------------------------------------------------------

class VastProvider implements GpuProvider {
    name = 'vast';

    private get apiKey(): string {
        return process.env.VAST_API_KEY || '';
    }

    private async apiCall(endpoint: string, method = 'GET', body?: any): Promise<any> {
        if (!this.apiKey) throw new Error('VAST_API_KEY not set.');
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
        const opts: RequestInit = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`https://console.vast.ai/api/v0${endpoint}`, opts);
        if (!res.ok) throw new Error(`Vast API ${res.status}: ${await res.text()}`);
        return res.json();
    }

    async provision(config: JobConfig): Promise<InstanceHandle> {
        // Search for cheapest matching offer
        const offers = await this.apiCall('/bundles?q=' + encodeURIComponent(JSON.stringify({
            gpu_name: { eq: config.gpuModel.toUpperCase() },
            rentable: { eq: true },
            order: [["dph_total", "asc"]],
            type: "on-demand"
        })));

        const best = offers?.offers?.[0];
        if (!best) throw new Error(`No Vast.ai offers found for GPU: ${config.gpuModel}`);

        const envVars = Object.entries(config.env).map(([k, v]) => `-e ${k}=${v}`).join(' ');

        const result = await this.apiCall(`/asks/${best.id}/`, 'PUT', {
            client_id: 'vertex',
            image: config.image,
            disk: config.diskGb,
            env: config.env,
            onstart: config.script ? `bash -c "${config.script}"` : undefined
        });

        if (!result?.success) throw new Error(`Vast provision failed: ${JSON.stringify(result)}`);

        return {
            provider: 'vast',
            instanceId: String(result.new_contract || best.id),
            sshPort: best.ssh_port || 22,
            ip: best.public_ipaddr
        };
    }

    async destroy(handle: InstanceHandle): Promise<string> {
        await this.apiCall(`/instances/${handle.instanceId}/`, 'DELETE');
        removeJob(handle.instanceId);
        return `Vast instance ${handle.instanceId} destroyed.`;
    }

    async status(handle: InstanceHandle): Promise<InstanceStatus> {
        const result = await this.apiCall(`/instances/${handle.instanceId}/`);
        const inst = result?.instances?.[0] || result;
        return {
            state: inst.actual_status === 'running' ? 'running' : 'provisioning',
            uptimeSeconds: inst.duration || 0,
            gpuUtilization: inst.gpu_util,
            cost: inst.dph_total
        };
    }

    async *streamLogs(handle: InstanceHandle): AsyncGenerator<string, void, unknown> {
        const result = await this.apiCall(`/instances/request/${handle.instanceId}/logs/`);
        yield result?.logs || 'No logs available.';
    }

    async listGpus(): Promise<GpuOffering[]> {
        const offers = await this.apiCall('/bundles?q=' + encodeURIComponent(JSON.stringify({
            rentable: { eq: true },
            order: [["dph_total", "asc"]],
            type: "on-demand",
            limit: 50
        })));
        const seen = new Set<string>();
        return (offers?.offers || [])
            .filter((o: any) => {
                if (seen.has(o.gpu_name)) return false;
                seen.add(o.gpu_name);
                return true;
            })
            .map((o: any) => ({
                model: o.gpu_name,
                vram: `${o.gpu_ram || '?'}MB`,
                pricePerHour: o.dph_total || 0,
                available: true
            }));
    }
}

// ---------------------------------------------------------------------------
// Local CUDA fallback
// ---------------------------------------------------------------------------

class LocalGpuProvider implements GpuProvider {
    name = 'local';

    async provision(config: JobConfig): Promise<InstanceHandle> {
        return {
            provider: 'local',
            instanceId: `local-${Date.now()}`,
            ip: '127.0.0.1'
        };
    }

    async destroy(handle: InstanceHandle): Promise<string> {
        removeJob(handle.instanceId);
        return 'Local job reference cleared.';
    }

    async status(_handle: InstanceHandle): Promise<InstanceStatus> {
        let gpuUtil: number | undefined;
        try {
            const { stdout } = await execAsync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits');
            gpuUtil = parseInt(stdout.trim());
        } catch { /* no nvidia-smi */ }

        return {
            state: 'running',
            uptimeSeconds: 0,
            gpuUtilization: gpuUtil,
        };
    }

    async *streamLogs(_handle: InstanceHandle): AsyncGenerator<string, void, unknown> {
        try {
            const { stdout } = await execAsync('nvidia-smi');
            yield stdout;
        } catch {
            yield 'nvidia-smi not available. No local GPU detected.';
        }
    }

    async listGpus(): Promise<GpuOffering[]> {
        try {
            const { stdout } = await execAsync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader');
            return stdout.trim().split('\n').map(line => {
                const [model, vram] = line.split(',').map(s => s.trim());
                return { model, vram, pricePerHour: 0, available: true };
            });
        } catch {
            return [{ model: 'None detected', vram: '0', pricePerHour: 0, available: false }];
        }
    }
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

function getProvider(name: string): GpuProvider {
    const providers: Record<string, GpuProvider> = {
        runpod: new RunPodProvider(),
        lambda: new LambdaProvider(),
        vast: new VastProvider(),
        local: new LocalGpuProvider()
    };
    const p = providers[name.toLowerCase()];
    if (!p) throw new Error(`Unknown GPU provider: ${name}. Available: ${Object.keys(providers).join(', ')}`);
    return p;
}

function autoDetectProvider(): GpuProvider {
    if (process.env.RUNPOD_API_KEY) return new RunPodProvider();
    if (process.env.LAMBDA_API_KEY) return new LambdaProvider();
    if (process.env.VAST_API_KEY) return new VastProvider();
    return new LocalGpuProvider();
}

// ---------------------------------------------------------------------------
// Tool: deploy_gpu_job
// ---------------------------------------------------------------------------

export class DeployGpuJobTool extends Tool {
    name = 'deploy_gpu_job';
    description = 'Deploy a training script or compute workload to a remote GPU instance (A100/H100/RTX4090). Supports RunPod, Lambda Labs, Vast.ai, and local CUDA. Streams execution and returns connection credentials.';
    schema = {
        type: 'object',
        properties: {
            script: {
                type: 'string',
                description: 'The shell command or script path to execute on the GPU instance'
            },
            gpuModel: {
                type: 'string',
                description: 'GPU model to provision (e.g., a100, h100, rtx4090, l40s, a6000)',
                default: 'a100'
            },
            provider: {
                type: 'string',
                enum: ['runpod', 'lambda', 'vast', 'local', 'auto'],
                description: 'Cloud GPU provider. "auto" picks based on available API keys.',
                default: 'auto'
            },
            image: {
                type: 'string',
                description: 'Docker image to use (e.g., pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime)',
                default: 'pytorch/pytorch:latest'
            },
            diskGb: {
                type: 'number',
                description: 'Disk space in GB',
                default: 50
            },
            env: {
                type: 'object',
                description: 'Environment variables to set on the instance',
                default: {}
            },
            args: {
                type: 'array',
                items: { type: 'string' },
                description: 'Extra CLI arguments for the container',
                default: []
            },
            ports: {
                type: 'array',
                items: { type: 'number' },
                description: 'Ports to expose (e.g., [8888] for Jupyter)',
                default: [8888]
            },
            maxRuntimeMin: {
                type: 'number',
                description: 'Maximum runtime in minutes before auto-termination',
                default: 120
            }
        },
        required: ['script']
    };

    async execute(args: any, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        const config: JobConfig = {
            script: args.script || '',
            gpuModel: args.gpuModel || 'a100',
            diskGb: args.diskGb || 50,
            image: args.image || 'pytorch/pytorch:latest',
            env: args.env || {},
            args: args.args || [],
            volumeMounts: [],
            ports: args.ports || [8888],
            maxRuntimeMin: args.maxRuntimeMin || 120
        };

        const providerName = args.provider || 'auto';
        const provider = providerName === 'auto' ? autoDetectProvider() : getProvider(providerName);

        const approved = await requestConfirmation(
            `[GPU DEPLOY] Provider: ${provider.name}\nGPU: ${config.gpuModel}\nImage: ${config.image}\nScript: ${config.script}\nDisk: ${config.diskGb}GB\nMax runtime: ${config.maxRuntimeMin}min\nProceed?`
        );
        if (!approved) return '[USER OVERRIDE]: GPU deployment cancelled.';

        try {
            const handle = await provider.provision(config);
            saveJob(handle, config);
            SharedContext.appendAudit({
                event: 'gpu_deploy',
                provider: provider.name,
                instanceId: handle.instanceId,
                gpu: config.gpuModel,
                image: config.image
            });

            const lines = [
                `[GPU DEPLOYED]`,
                `  Provider:    ${provider.name}`,
                `  Instance:    ${handle.instanceId}`,
                `  GPU:         ${config.gpuModel}`,
                `  Image:       ${config.image}`,
                `  Script:      ${config.script}`,
            ];
            if (handle.ip) lines.push(`  IP:          ${handle.ip}`);
            if (handle.sshPort) lines.push(`  SSH:         ssh root@${handle.ip} -p ${handle.sshPort}`);
            if (handle.apiEndpoint) lines.push(`  API:         ${handle.apiEndpoint}`);
            lines.push(`  Max runtime: ${config.maxRuntimeMin} min`);
            lines.push(`\nUse gpu_status or gpu_logs to monitor. Use gpu_destroy to terminate.`);

            return lines.join('\n');
        } catch (e: any) {
            return `[GPU DEPLOY FAILED]: ${e.message}`;
        }
    }
}

// ---------------------------------------------------------------------------
// Tool: gpu_status
// ---------------------------------------------------------------------------

export class GpuStatusTool extends Tool {
    name = 'gpu_status';
    description = 'Check the status of a running GPU instance or list all active GPU jobs.';
    schema = {
        type: 'object',
        properties: {
            instanceId: {
                type: 'string',
                description: 'Instance ID to check. Omit to list all active jobs.'
            },
            provider: {
                type: 'string',
                description: 'Provider name (runpod/lambda/vast/local). Auto-detected from saved state if omitted.'
            }
        },
        required: []
    };

    async execute(args: any): Promise<string> {
        if (!args.instanceId) {
            const jobs = loadJobs();
            if (jobs.length === 0) return 'No active GPU jobs tracked.';
            const lines = ['Active GPU Jobs:', ''];
            for (const job of jobs) {
                const h = job.handle;
                lines.push(`  ${h.instanceId} | ${h.provider} | started: ${job.startedAt} | gpu: ${job.config.gpuModel}`);
            }
            return lines.join('\n');
        }

        const jobs = loadJobs();
        const job = jobs.find(j => j.handle.instanceId === args.instanceId);
        const providerName = args.provider || job?.handle.provider || 'local';
        const provider = getProvider(providerName);

        const handle: InstanceHandle = job?.handle || { provider: providerName, instanceId: args.instanceId };
        const status = await provider.status(handle);

        const lines = [
            `[GPU STATUS] ${args.instanceId}`,
            `  Provider:        ${providerName}`,
            `  State:           ${status.state}`,
            `  Uptime:          ${Math.floor(status.uptimeSeconds / 60)}m ${status.uptimeSeconds % 60}s`,
        ];
        if (status.gpuUtilization !== undefined) lines.push(`  GPU Utilization: ${status.gpuUtilization}%`);
        if (status.memoryUsedMb !== undefined) lines.push(`  Memory Used:     ${status.memoryUsedMb}MB`);
        if (status.cost !== undefined) lines.push(`  Cost/hr:         $${status.cost}`);

        return lines.join('\n');
    }
}

// ---------------------------------------------------------------------------
// Tool: gpu_logs
// ---------------------------------------------------------------------------

export class GpuLogsTool extends Tool {
    name = 'gpu_logs';
    description = 'Stream or fetch logs from a running GPU instance.';
    schema = {
        type: 'object',
        properties: {
            instanceId: {
                type: 'string',
                description: 'Instance ID to fetch logs from'
            },
            provider: {
                type: 'string',
                description: 'Provider name. Auto-detected if omitted.'
            }
        },
        required: ['instanceId']
    };

    async *execute(args: any): AsyncGenerator<string, string, unknown> {
        const jobs = loadJobs();
        const job = jobs.find(j => j.handle.instanceId === args.instanceId);
        const providerName = args.provider || job?.handle.provider || 'local';
        const provider = getProvider(providerName);
        const handle: InstanceHandle = job?.handle || { provider: providerName, instanceId: args.instanceId };

        for await (const chunk of provider.streamLogs(handle)) {
            yield chunk;
        }
        return '';
    }
}

// ---------------------------------------------------------------------------
// Tool: gpu_destroy
// ---------------------------------------------------------------------------

export class GpuDestroyTool extends Tool {
    name = 'gpu_destroy';
    description = 'Terminate and destroy a GPU instance to stop billing.';
    schema = {
        type: 'object',
        properties: {
            instanceId: {
                type: 'string',
                description: 'Instance ID to terminate'
            },
            provider: {
                type: 'string',
                description: 'Provider name. Auto-detected if omitted.'
            }
        },
        required: ['instanceId']
    };

    async execute(args: any, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        const jobs = loadJobs();
        const job = jobs.find(j => j.handle.instanceId === args.instanceId);
        const providerName = args.provider || job?.handle.provider || 'local';
        const provider = getProvider(providerName);
        const handle: InstanceHandle = job?.handle || { provider: providerName, instanceId: args.instanceId };

        const approved = await requestConfirmation(`[GPU DESTROY] Terminate instance ${args.instanceId} on ${providerName}?`);
        if (!approved) return '[USER OVERRIDE]: Destruction cancelled.';

        return provider.destroy(handle);
    }
}

// ---------------------------------------------------------------------------
// Tool: gpu_list
// ---------------------------------------------------------------------------

export class GpuListTool extends Tool {
    name = 'gpu_list';
    description = 'List available GPU types and pricing from a provider.';
    schema = {
        type: 'object',
        properties: {
            provider: {
                type: 'string',
                enum: ['runpod', 'lambda', 'vast', 'local', 'auto'],
                description: 'Provider to query. Defaults to auto-detect.',
                default: 'auto'
            }
        },
        required: []
    };

    async execute(args: any): Promise<string> {
        const providerName = args.provider || 'auto';
        const provider = providerName === 'auto' ? autoDetectProvider() : getProvider(providerName);

        const gpus = await provider.listGpus();
        if (gpus.length === 0) return `No GPUs available on ${provider.name}.`;

        const lines = [`Available GPUs on ${provider.name}:`, ''];
        lines.push('  Model                          | VRAM    | $/hr    | Available');
        lines.push('  ' + '-'.repeat(70));
        for (const g of gpus) {
            const model = g.model.padEnd(30);
            const vram = g.vram.padEnd(7);
            const price = `$${g.pricePerHour.toFixed(2)}`.padEnd(7);
            const avail = g.available ? 'Yes' : 'No';
            lines.push(`  ${model} | ${vram} | ${price} | ${avail}`);
        }
        return lines.join('\n');
    }
}

// ---------------------------------------------------------------------------
// Tool: gpu_ssh
// ---------------------------------------------------------------------------

export class GpuSshTool extends Tool {
    name = 'gpu_ssh';
    description = 'Execute a command on a running GPU instance via SSH.';
    schema = {
        type: 'object',
        properties: {
            instanceId: {
                type: 'string',
                description: 'Instance ID'
            },
            command: {
                type: 'string',
                description: 'Command to execute remotely'
            },
            provider: {
                type: 'string',
                description: 'Provider name. Auto-detected if omitted.'
            }
        },
        required: ['instanceId', 'command']
    };

    async execute(args: any, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        const jobs = loadJobs();
        const job = jobs.find(j => j.handle.instanceId === args.instanceId);
        const handle = job?.handle;

        if (!handle?.ip) {
            return `[SSH ERROR]: No IP found for instance ${args.instanceId}. Instance may still be provisioning.`;
        }

        const approved = await requestConfirmation(`[GPU SSH] Run on ${handle.ip}:\n  > ${args.command}`);
        if (!approved) return '[USER OVERRIDE]: SSH command cancelled.';

        if (!/^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])$/.test(handle.ip)) {
            return '[SSH ERROR]: Invalid host address for this instance.';
        }
        const port = handle.sshPort ?? 22;
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            return '[SSH ERROR]: Invalid SSH port for this instance.';
        }

        // Avoid local shell interpolation and do not disable host-key verification.
        // accept-new pins the first observed key and rejects later key changes.
        try {
            const { stdout, stderr } = await execFileAsync('ssh', [
                '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'ConnectTimeout=10',
                '-p', String(port),
                '--', `root@${handle.ip}`,
                String(args.command)
            ], { timeout: 60000, maxBuffer: 1024 * 1024 });
            return (stdout.trim() + (stderr.trim() ? `\nSTDERR: ${stderr.trim()}` : '')) || 'Command completed.';
        } catch (e: any) {
            return `[SSH ERROR]: ${e.message}\n${e.stderr || ''}`;
        }
    }
}

import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type JsonMessage = Record<string, unknown>;

const PROVIDER_KEY_ENVS = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'XAI_API_KEY',
    'GROQ_API_KEY',
    'DEEPSEEK_API_KEY',
    'MISTRAL_API_KEY',
    'OPENROUTER_API_KEY',
];

function resolveSidecarCwd(): string {
    const nested = path.join(process.cwd(), 'sidecar', 'src', 'main.ts');
    if (fs.existsSync(nested)) {
        return path.join(process.cwd(), 'sidecar');
    }
    return process.cwd();
}

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function toString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function buildNoProviderKeyEnv(appDataDir: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        COWORKANY_APP_DATA_DIR: appDataDir,
        COWORKANY_MODEL: 'anthropic/claude-sonnet-4-5',
        COWORKANY_RUNTIME_MODE: 'mastra',
    };
    for (const key of PROVIDER_KEY_ENVS) {
        delete env[key];
    }
    return env;
}

class MastraStdioSession {
    private proc: Subprocess | null = null;
    private stdoutBuffer = '';
    private stderrBuffer = '';
    readonly messages: JsonMessage[] = [];
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;

    constructor(options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
        this.cwd = options?.cwd ?? resolveSidecarCwd();
        this.env = {
            ...process.env,
            ...(options?.env ?? {}),
        };
    }

    async start(): Promise<void> {
        this.proc = spawn({
            cmd: ['bun', 'run', 'src/main.ts'],
            cwd: this.cwd,
            env: this.env,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
        });
        this.readStdout();
        this.readStderr();
        await this.waitFor(
            0,
            (message) => message.type === 'ready' && message.runtime === 'mastra',
            20_000,
        );
    }

    private readStdout(): void {
        if (!this.proc) {
            return;
        }
        const stdoutStream = this.proc.stdout;
        (async () => {
            try {
                for await (const chunk of stdoutStream) {
                    this.stdoutBuffer += new TextDecoder().decode(chunk);
                    const lines = this.stdoutBuffer.split('\n');
                    this.stdoutBuffer = lines.pop() ?? '';
                    for (const line of lines) {
                        if (!line.trim()) {
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(line) as unknown;
                            this.messages.push(toRecord(parsed));
                        } catch {
                            // ignore non-json lines
                        }
                    }
                }
            } catch {
                // stream closed
            }
        })();
    }

    private readStderr(): void {
        if (!this.proc) {
            return;
        }
        const stderrStream = this.proc.stderr;
        (async () => {
            try {
                for await (const chunk of stderrStream) {
                    this.stderrBuffer += new TextDecoder().decode(chunk);
                }
            } catch {
                // stream closed
            }
        })();
    }

    mark(): number {
        return this.messages.length;
    }

    send(message: JsonMessage): void {
        if (!this.proc?.stdin) {
            throw new Error('sidecar stdin unavailable');
        }
        this.proc.stdin.write(`${JSON.stringify(message)}\n`);
        this.proc.stdin.flush();
    }

    async waitFor(
        fromIndex: number,
        predicate: (message: JsonMessage) => boolean,
        timeoutMs: number,
    ): Promise<JsonMessage> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const hit = this.messages.slice(fromIndex).find((message) => predicate(message));
            if (hit) {
                return hit;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(
            `waitFor timed out after ${timeoutMs}ms. fromIndex=${fromIndex} recent=${JSON.stringify(this.messages.slice(-10))} stderr=${this.stderrBuffer.slice(-600)}`,
        );
    }

    stop(): void {
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
        }
    }
}

let session: MastraStdioSession | null = null;
let appDataDirInTest: string | null = null;

afterEach(() => {
    session?.stop();
    session = null;
    if (appDataDirInTest && fs.existsSync(appDataDirInTest)) {
        fs.rmSync(appDataDirInTest, { recursive: true, force: true });
    }
    appDataDirInTest = null;
});

describe('additional commands full-chain e2e', () => {
    test('get_mcp_connection_status command returns runtime snapshot', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mcp-status-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const commandId = `cmd-mcp-status-${randomUUID()}`;
        const fromIndex = session.mark();
        session.send({
            id: commandId,
            timestamp: new Date().toISOString(),
            type: 'get_mcp_connection_status',
            payload: {},
        });

        const response = await session.waitFor(
            fromIndex,
            (message) => message.type === 'get_mcp_connection_status_response' && message.commandId === commandId,
            8_000,
        );
        const payload = toRecord(response.payload);
        const snapshot = toRecord(payload.snapshot);

        expect(payload.success).toBe(true);
        expect(typeof snapshot.enabled).toBe('boolean');
        expect(typeof snapshot.status).toBe('string');
    }, 30_000);

    test('MCP governance commands are reachable via stdio full-chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mcp-governance-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const upsertId = `cmd-mcp-upsert-${randomUUID()}`;
        const upsertFrom = session.mark();
        session.send({
            id: upsertId,
            timestamp: new Date().toISOString(),
            type: 'upsert_mcp_server',
            payload: {
                server: {
                    id: 'e2e-user-server',
                    command: 'npx',
                    args: ['-y', 'example-server'],
                    scope: 'user',
                    enabled: true,
                },
            },
        });
        const upsertResponse = await session.waitFor(
            upsertFrom,
            (message) => message.type === 'upsert_mcp_server_response' && message.commandId === upsertId,
            8_000,
        );
        const upsertPayload = toRecord(upsertResponse.payload);
        expect(upsertPayload.success).toBe(true);
        const blockedServerIds = Array.isArray(upsertPayload.blockedServerIds)
            ? upsertPayload.blockedServerIds as string[]
            : [];
        expect(blockedServerIds.includes('e2e-user-server')).toBe(true);

        const approveId = `cmd-mcp-approve-${randomUUID()}`;
        const approveFrom = session.mark();
        session.send({
            id: approveId,
            timestamp: new Date().toISOString(),
            type: 'set_mcp_server_approval',
            payload: {
                id: 'e2e-user-server',
                approved: true,
            },
        });
        const approveResponse = await session.waitFor(
            approveFrom,
            (message) => message.type === 'set_mcp_server_approval_response' && message.commandId === approveId,
            8_000,
        );
        const approvePayload = toRecord(approveResponse.payload);
        expect(approvePayload.success).toBe(true);
        const allowedServerIds = Array.isArray(approvePayload.allowedServerIds)
            ? approvePayload.allowedServerIds as string[]
            : [];
        expect(allowedServerIds.includes('e2e-user-server')).toBe(true);

        const listId = `cmd-mcp-list-${randomUUID()}`;
        const listFrom = session.mark();
        session.send({
            id: listId,
            timestamp: new Date().toISOString(),
            type: 'list_mcp_servers',
            payload: {},
        });
        const listResponse = await session.waitFor(
            listFrom,
            (message) => message.type === 'list_mcp_servers_response' && message.commandId === listId,
            8_000,
        );
        const listPayload = toRecord(listResponse.payload);
        const servers = Array.isArray(listPayload.servers) ? listPayload.servers.map((server) => toRecord(server)) : [];
        expect(servers.some((server) => toString(server.id) === 'e2e-user-server')).toBe(true);
    }, 30_000);

    test('remote session bind + channel event injection roundtrip through main flow', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-remote-channel-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const bindId = `cmd-bind-remote-${randomUUID()}`;
        const bindFrom = session.mark();
        session.send({
            id: bindId,
            timestamp: new Date().toISOString(),
            type: 'bind_remote_session',
            payload: {
                taskId: 'task-remote-e2e',
                remoteSessionId: 'remote-e2e-1',
            },
        });
        const bindResponse = await session.waitFor(
            bindFrom,
            (message) => message.type === 'bind_remote_session_response' && message.commandId === bindId,
            8_000,
        );
        expect(toRecord(bindResponse.payload).success).toBe(true);

        const injectId = `cmd-inject-channel-${randomUUID()}`;
        const injectFrom = session.mark();
        session.send({
            id: injectId,
            timestamp: new Date().toISOString(),
            type: 'inject_channel_event',
            payload: {
                remoteSessionId: 'remote-e2e-1',
                channel: 'slack',
                eventType: 'mention',
                content: 'e2e remote event',
                metadata: {
                    threadTs: '987.654',
                },
            },
        });
        const injectResponse = await session.waitFor(
            injectFrom,
            (message) => message.type === 'inject_channel_event_response' && message.commandId === injectId,
            8_000,
        );
        expect(toRecord(injectResponse.payload).success).toBe(true);
        await session.waitFor(
            injectFrom,
            (message) =>
                message.type === 'TASK_EVENT'
                && message.taskId === 'task-remote-e2e'
                && toString(toRecord(message.payload).type) === 'channel_event',
            8_000,
        );

        const transcriptId = `cmd-transcript-${randomUUID()}`;
        const transcriptFrom = session.mark();
        session.send({
            id: transcriptId,
            timestamp: new Date().toISOString(),
            type: 'get_task_transcript',
            payload: {
                taskId: 'task-remote-e2e',
            },
        });
        const transcriptResponse = await session.waitFor(
            transcriptFrom,
            (message) => message.type === 'get_task_transcript_response' && message.commandId === transcriptId,
            8_000,
        );
        const transcriptPayload = toRecord(transcriptResponse.payload);
        const entries = Array.isArray(transcriptPayload.entries)
            ? transcriptPayload.entries.map((entry) => toRecord(entry))
            : [];
        expect(entries.some((entry) => toString(entry.content).includes('[Channel:slack]'))).toBe(true);

        const hooksId = `cmd-hooks-${randomUUID()}`;
        const hooksFrom = session.mark();
        session.send({
            id: hooksId,
            timestamp: new Date().toISOString(),
            type: 'get_hook_events',
            payload: {
                taskId: 'task-remote-e2e',
            },
        });
        const hooksResponse = await session.waitFor(
            hooksFrom,
            (message) => message.type === 'get_hook_events_response' && message.commandId === hooksId,
            8_000,
        );
        const hooksPayload = toRecord(hooksResponse.payload);
        const hookEntries = Array.isArray(hooksPayload.entries)
            ? hooksPayload.entries.map((entry) => toRecord(entry))
            : [];
        expect(hookEntries.some((entry) => toString(entry.type) === 'RemoteSessionLinked')).toBe(true);
        expect(hookEntries.some((entry) => toString(entry.type) === 'ChannelEventInjected')).toBe(true);
    }, 30_000);

    test('remote session governance policy enforces managed tenant requirement in full chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-remote-governance-fullchain-'));
        session = new MastraStdioSession({
            env: {
                ...buildNoProviderKeyEnv(appDataDirInTest),
                COWORKANY_REMOTE_SESSION_REQUIRE_TENANT_ID_FOR_MANAGED: 'true',
            },
        });
        await session.start();

        const deniedId = `cmd-open-managed-denied-${randomUUID()}`;
        const deniedFrom = session.mark();
        session.send({
            id: deniedId,
            timestamp: new Date().toISOString(),
            type: 'open_remote_session',
            payload: {
                taskId: 'task-remote-governance-e2e',
                remoteSessionId: 'remote-governance-e2e',
                scope: 'managed',
                metadata: {
                    endpointId: 'desktop-e2e',
                },
            },
        });
        const deniedResponse = await session.waitFor(
            deniedFrom,
            (message) => message.type === 'open_remote_session_response' && message.commandId === deniedId,
            8_000,
        );
        const deniedPayload = toRecord(deniedResponse.payload);
        expect(deniedPayload.success).toBe(false);
        expect(toString(deniedPayload.error)).toBe('remote_session_tenant_required');

        const allowId = `cmd-open-managed-allowed-${randomUUID()}`;
        const allowFrom = session.mark();
        session.send({
            id: allowId,
            timestamp: new Date().toISOString(),
            type: 'open_remote_session',
            payload: {
                taskId: 'task-remote-governance-e2e',
                remoteSessionId: 'remote-governance-e2e',
                scope: 'managed',
                metadata: {
                    endpointId: 'desktop-e2e',
                    tenantId: 'tenant-e2e',
                },
            },
        });
        const allowResponse = await session.waitFor(
            allowFrom,
            (message) => message.type === 'open_remote_session_response' && message.commandId === allowId,
            8_000,
        );
        expect(toRecord(allowResponse.payload).success).toBe(true);
    }, 30_000);

    test('remote session governance policy can enforce managed endpoint requirement in full chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-remote-governance-endpoint-fullchain-'));
        session = new MastraStdioSession({
            env: {
                ...buildNoProviderKeyEnv(appDataDirInTest),
                COWORKANY_REMOTE_SESSION_REQUIRE_TENANT_ID_FOR_MANAGED: 'true',
                COWORKANY_REMOTE_SESSION_REQUIRE_ENDPOINT_ID_FOR_MANAGED: 'true',
            },
        });
        await session.start();

        const deniedId = `cmd-open-managed-no-endpoint-${randomUUID()}`;
        const deniedFrom = session.mark();
        session.send({
            id: deniedId,
            timestamp: new Date().toISOString(),
            type: 'open_remote_session',
            payload: {
                taskId: 'task-remote-governance-endpoint-e2e',
                remoteSessionId: 'remote-governance-endpoint-e2e',
                scope: 'managed',
                metadata: {
                    tenantId: 'tenant-e2e',
                },
            },
        });
        const deniedResponse = await session.waitFor(
            deniedFrom,
            (message) => message.type === 'open_remote_session_response' && message.commandId === deniedId,
            8_000,
        );
        const deniedPayload = toRecord(deniedResponse.payload);
        expect(deniedPayload.success).toBe(false);
        expect(toString(deniedPayload.error)).toBe('remote_session_endpoint_required');
    }, 30_000);

    test('managed channel command governance enforces tenant context in full chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-remote-governance-channel-tenant-fullchain-'));
        session = new MastraStdioSession({
            env: {
                ...buildNoProviderKeyEnv(appDataDirInTest),
                COWORKANY_REMOTE_SESSION_REQUIRE_TENANT_ID_FOR_MANAGED_COMMANDS: 'true',
            },
        });
        await session.start();

        const openId = `cmd-open-managed-channel-${randomUUID()}`;
        const openFrom = session.mark();
        session.send({
            id: openId,
            timestamp: new Date().toISOString(),
            type: 'open_remote_session',
            payload: {
                taskId: 'task-remote-managed-channel-e2e',
                remoteSessionId: 'remote-managed-channel-e2e',
                scope: 'managed',
                metadata: {
                    tenantId: 'tenant-e2e',
                    endpointId: 'desktop-e2e',
                },
            },
        });
        const openResponse = await session.waitFor(
            openFrom,
            (message) => message.type === 'open_remote_session_response' && message.commandId === openId,
            8_000,
        );
        expect(toRecord(openResponse.payload).success).toBe(true);

        const listMissingTenantId = `cmd-list-channel-missing-tenant-${randomUUID()}`;
        const listMissingTenantFrom = session.mark();
        session.send({
            id: listMissingTenantId,
            timestamp: new Date().toISOString(),
            type: 'list_channel_delivery_events',
            payload: {
                remoteSessionId: 'remote-managed-channel-e2e',
            },
        });
        const listMissingTenantResponse = await session.waitFor(
            listMissingTenantFrom,
            (message) => message.type === 'list_channel_delivery_events_response' && message.commandId === listMissingTenantId,
            8_000,
        );
        expect(toString(toRecord(listMissingTenantResponse.payload).error)).toBe('remote_session_tenant_command_required');

        const listWrongTenantId = `cmd-list-channel-wrong-tenant-${randomUUID()}`;
        const listWrongTenantFrom = session.mark();
        session.send({
            id: listWrongTenantId,
            timestamp: new Date().toISOString(),
            type: 'list_channel_delivery_events',
            payload: {
                remoteSessionId: 'remote-managed-channel-e2e',
                tenantId: 'tenant-wrong',
            },
        });
        const listWrongTenantResponse = await session.waitFor(
            listWrongTenantFrom,
            (message) => message.type === 'list_channel_delivery_events_response' && message.commandId === listWrongTenantId,
            8_000,
        );
        expect(toString(toRecord(listWrongTenantResponse.payload).error)).toBe('remote_session_tenant_command_mismatch');

        const listOkId = `cmd-list-channel-ok-tenant-${randomUUID()}`;
        const listOkFrom = session.mark();
        session.send({
            id: listOkId,
            timestamp: new Date().toISOString(),
            type: 'list_channel_delivery_events',
            payload: {
                remoteSessionId: 'remote-managed-channel-e2e',
                tenantId: 'tenant-e2e',
            },
        });
        const listOkResponse = await session.waitFor(
            listOkFrom,
            (message) => message.type === 'list_channel_delivery_events_response' && message.commandId === listOkId,
            8_000,
        );
        expect(toRecord(listOkResponse.payload).success).toBe(true);
    }, 30_000);

    test('marketplace trust governance + audit commands work through full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-marketplace-governance-fullchain-'));
        session = new MastraStdioSession({
            env: {
                ...buildNoProviderKeyEnv(appDataDirInTest),
                COWORKANY_MARKETPLACE_TRUST_MODE: 'enforce',
                COWORKANY_MARKETPLACE_BLOCKED_OWNERS: 'blocked-owner',
            },
        });
        await session.start();

        const validateId = `cmd-marketplace-validate-${randomUUID()}`;
        const validateFrom = session.mark();
        session.send({
            id: validateId,
            timestamp: new Date().toISOString(),
            type: 'validate_github_url',
            payload: {
                url: 'github:blocked-owner/blocked-repo',
                type: 'skill',
            },
        });
        const validateResponse = await session.waitFor(
            validateFrom,
            (message) => message.type === 'validate_github_url_response' && message.commandId === validateId,
            8_000,
        );
        const validatePayload = toRecord(validateResponse.payload);
        expect(validatePayload.valid).toBe(false);
        expect(toString(validatePayload.reason)).toBe('marketplace_owner_blocked');

        const installId = `cmd-marketplace-install-${randomUUID()}`;
        const installFrom = session.mark();
        session.send({
            id: installId,
            timestamp: new Date().toISOString(),
            type: 'install_from_github',
            payload: {
                source: 'github:blocked-owner/blocked-repo',
                targetType: 'skill',
                workspacePath: session.cwd,
            },
        });
        const installResponse = await session.waitFor(
            installFrom,
            (message) => message.type === 'install_from_github_response' && message.commandId === installId,
            8_000,
        );
        const installPayload = toRecord(installResponse.payload);
        const auditEntryId = toString(installPayload.auditEntryId);
        expect(installPayload.success).toBe(false);
        expect(toString(installPayload.error)).toBe('marketplace_owner_blocked');
        expect(auditEntryId).not.toBe('');

        const listAuditId = `cmd-marketplace-audit-${randomUUID()}`;
        const listAuditFrom = session.mark();
        session.send({
            id: listAuditId,
            timestamp: new Date().toISOString(),
            type: 'list_marketplace_audit_log',
            payload: {
                limit: 20,
            },
        });
        const listAuditResponse = await session.waitFor(
            listAuditFrom,
            (message) => message.type === 'list_marketplace_audit_log_response' && message.commandId === listAuditId,
            8_000,
        );
        const listAuditPayload = toRecord(listAuditResponse.payload);
        const entries = Array.isArray(listAuditPayload.entries)
            ? (listAuditPayload.entries as unknown[]).map((entry) => toRecord(entry))
            : [];
        expect(entries.some((entry) => toString(entry.id) === auditEntryId)).toBe(true);
    }, 30_000);

    test('managed settings sync/rollback commands work through full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-managed-settings-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const serverId = `managed-fullchain-${randomUUID().slice(0, 8)}`;
        const syncId = `cmd-managed-sync-${randomUUID()}`;
        const syncFrom = session.mark();
        session.send({
            id: syncId,
            timestamp: new Date().toISOString(),
            type: 'sync_managed_settings',
            payload: {
                settings: {
                    mcpServers: [{
                        id: serverId,
                        command: 'npx',
                        args: ['-y', 'demo-managed-fullchain'],
                        scope: 'project',
                        enabled: true,
                        approved: true,
                    }],
                },
            },
        });
        const syncResponse = await session.waitFor(
            syncFrom,
            (message) => message.type === 'sync_managed_settings_response' && message.commandId === syncId,
            8_000,
        );
        const syncPayload = toRecord(syncResponse.payload);
        const syncEntryId = toString(syncPayload.syncEntryId);
        expect(syncPayload.success).toBe(true);
        expect(syncEntryId).not.toBe('');

        const listServersAfterSyncId = `cmd-managed-list-after-sync-${randomUUID()}`;
        const listServersAfterSyncFrom = session.mark();
        session.send({
            id: listServersAfterSyncId,
            timestamp: new Date().toISOString(),
            type: 'list_mcp_servers',
            payload: {},
        });
        const listServersAfterSyncResponse = await session.waitFor(
            listServersAfterSyncFrom,
            (message) => message.type === 'list_mcp_servers_response' && message.commandId === listServersAfterSyncId,
            8_000,
        );
        const serversAfterSync = Array.isArray(toRecord(listServersAfterSyncResponse.payload).servers)
            ? (toRecord(listServersAfterSyncResponse.payload).servers as unknown[]).map((server) => toRecord(server))
            : [];
        expect(serversAfterSync.some((server) => toString(server.id) === serverId)).toBe(true);

        const rollbackId = `cmd-managed-rollback-${randomUUID()}`;
        const rollbackFrom = session.mark();
        session.send({
            id: rollbackId,
            timestamp: new Date().toISOString(),
            type: 'rollback_managed_settings',
            payload: {
                entryId: syncEntryId,
            },
        });
        const rollbackResponse = await session.waitFor(
            rollbackFrom,
            (message) => message.type === 'rollback_managed_settings_response' && message.commandId === rollbackId,
            8_000,
        );
        const rollbackPayload = toRecord(rollbackResponse.payload);
        expect(rollbackPayload.success).toBe(true);

        const listServersAfterRollbackId = `cmd-managed-list-after-rollback-${randomUUID()}`;
        const listServersAfterRollbackFrom = session.mark();
        session.send({
            id: listServersAfterRollbackId,
            timestamp: new Date().toISOString(),
            type: 'list_mcp_servers',
            payload: {},
        });
        const listServersAfterRollbackResponse = await session.waitFor(
            listServersAfterRollbackFrom,
            (message) => message.type === 'list_mcp_servers_response' && message.commandId === listServersAfterRollbackId,
            8_000,
        );
        const serversAfterRollback = Array.isArray(toRecord(listServersAfterRollbackResponse.payload).servers)
            ? (toRecord(listServersAfterRollbackResponse.payload).servers as unknown[]).map((server) => toRecord(server))
            : [];
        expect(serversAfterRollback.some((server) => toString(server.id) === serverId)).toBe(false);

        const listLogId = `cmd-managed-log-${randomUUID()}`;
        const listLogFrom = session.mark();
        session.send({
            id: listLogId,
            timestamp: new Date().toISOString(),
            type: 'list_managed_settings_sync_log',
            payload: {
                action: 'rollback',
                limit: 10,
            },
        });
        const listLogResponse = await session.waitFor(
            listLogFrom,
            (message) => message.type === 'list_managed_settings_sync_log_response' && message.commandId === listLogId,
            8_000,
        );
        const listLogPayload = toRecord(listLogResponse.payload);
        const entries = Array.isArray(listLogPayload.entries)
            ? (listLogPayload.entries as unknown[]).map((entry) => toRecord(entry))
            : [];
        expect(entries.some((entry) => toString(entry.source) === syncEntryId)).toBe(true);
    }, 30_000);

    test('channel delivery list/ack/replay commands work through full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-channel-delivery-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const bindId = `cmd-bind-delivery-${randomUUID()}`;
        const bindFrom = session.mark();
        session.send({
            id: bindId,
            timestamp: new Date().toISOString(),
            type: 'bind_remote_session',
            payload: {
                taskId: 'task-delivery-fullchain',
                remoteSessionId: 'remote-delivery-fullchain',
            },
        });
        await session.waitFor(
            bindFrom,
            (message) => message.type === 'bind_remote_session_response' && message.commandId === bindId,
            8_000,
        );

        const injectId = `cmd-inject-delivery-${randomUUID()}`;
        const injectFrom = session.mark();
        session.send({
            id: injectId,
            timestamp: new Date().toISOString(),
            type: 'inject_channel_event',
            payload: {
                remoteSessionId: 'remote-delivery-fullchain',
                channel: 'slack',
                eventType: 'mention',
                content: 'delivery pending from fullchain',
                metadata: {
                    ts: '555.666',
                },
            },
        });
        const injectResponse = await session.waitFor(
            injectFrom,
            (message) => message.type === 'inject_channel_event_response' && message.commandId === injectId,
            8_000,
        );
        const delivery = toRecord(toRecord(injectResponse.payload).delivery);
        const deliveryId = toString(delivery.id);
        expect(deliveryId).not.toBe('');

        const listPendingId = `cmd-list-delivery-pending-${randomUUID()}`;
        const listPendingFrom = session.mark();
        session.send({
            id: listPendingId,
            timestamp: new Date().toISOString(),
            type: 'list_channel_delivery_events',
            payload: {
                remoteSessionId: 'remote-delivery-fullchain',
                status: 'pending',
            },
        });
        const listPendingResponse = await session.waitFor(
            listPendingFrom,
            (message) => message.type === 'list_channel_delivery_events_response' && message.commandId === listPendingId,
            8_000,
        );
        const pendingEvents = Array.isArray(toRecord(listPendingResponse.payload).events)
            ? (toRecord(listPendingResponse.payload).events as unknown[]).map((item) => toRecord(item))
            : [];
        expect(pendingEvents.some((event) => toString(event.id) === deliveryId)).toBe(true);

        const replayId = `cmd-replay-delivery-${randomUUID()}`;
        const replayFrom = session.mark();
        session.send({
            id: replayId,
            timestamp: new Date().toISOString(),
            type: 'replay_channel_delivery_events',
            payload: {
                remoteSessionId: 'remote-delivery-fullchain',
            },
        });
        const replayResponse = await session.waitFor(
            replayFrom,
            (message) => message.type === 'replay_channel_delivery_events_response' && message.commandId === replayId,
            8_000,
        );
        expect(toRecord(replayResponse.payload).success).toBe(true);
        await session.waitFor(
            replayFrom,
            (message) =>
                message.type === 'TASK_EVENT'
                && message.taskId === 'task-delivery-fullchain'
                && toString(toRecord(message.payload).action) === 'replayed'
                && toString(toRecord(message.payload).deliveryId) === deliveryId,
            8_000,
        );

        const ackId = `cmd-ack-delivery-${randomUUID()}`;
        const ackFrom = session.mark();
        session.send({
            id: ackId,
            timestamp: new Date().toISOString(),
            type: 'ack_channel_delivery_event',
            payload: {
                eventId: deliveryId,
                remoteSessionId: 'remote-delivery-fullchain',
                metadata: {
                    from: 'fullchain-test',
                },
            },
        });
        const ackResponse = await session.waitFor(
            ackFrom,
            (message) => message.type === 'ack_channel_delivery_event_response' && message.commandId === ackId,
            8_000,
        );
        const ackEvent = toRecord(toRecord(ackResponse.payload).event);
        expect(toString(ackEvent.status)).toBe('acked');
        expect(toString(toRecord(ackEvent.ackMetadata).from)).toBe('fullchain-test');

        const listAckedId = `cmd-list-delivery-acked-${randomUUID()}`;
        const listAckedFrom = session.mark();
        session.send({
            id: listAckedId,
            timestamp: new Date().toISOString(),
            type: 'list_channel_delivery_events',
            payload: {
                remoteSessionId: 'remote-delivery-fullchain',
                status: 'acked',
            },
        });
        const listAckedResponse = await session.waitFor(
            listAckedFrom,
            (message) => message.type === 'list_channel_delivery_events_response' && message.commandId === listAckedId,
            8_000,
        );
        const ackedEvents = Array.isArray(toRecord(listAckedResponse.payload).events)
            ? (toRecord(listAckedResponse.payload).events as unknown[]).map((item) => toRecord(item))
            : [];
        expect(ackedEvents.some((event) => toString(event.id) === deliveryId)).toBe(true);
    }, 30_000);

    test('sync_remote_session replays pending deliveries and can ack in full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-remote-sync-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const bindId = `cmd-bind-sync-${randomUUID()}`;
        const bindFrom = session.mark();
        session.send({
            id: bindId,
            timestamp: new Date().toISOString(),
            type: 'bind_remote_session',
            payload: {
                taskId: 'task-remote-sync-fullchain',
                remoteSessionId: 'remote-sync-fullchain',
            },
        });
        await session.waitFor(
            bindFrom,
            (message) => message.type === 'bind_remote_session_response' && message.commandId === bindId,
            8_000,
        );

        const injectId = `cmd-inject-sync-${randomUUID()}`;
        const injectFrom = session.mark();
        session.send({
            id: injectId,
            timestamp: new Date().toISOString(),
            type: 'inject_channel_event',
            payload: {
                remoteSessionId: 'remote-sync-fullchain',
                channel: 'slack',
                eventType: 'mention',
                content: 'sync this pending delivery',
                eventId: 'delivery-sync-fullchain-1',
            },
        });
        await session.waitFor(
            injectFrom,
            (message) => message.type === 'inject_channel_event_response' && message.commandId === injectId,
            8_000,
        );

        const syncId = `cmd-sync-session-${randomUUID()}`;
        const syncFrom = session.mark();
        session.send({
            id: syncId,
            timestamp: new Date().toISOString(),
            type: 'sync_remote_session',
            payload: {
                remoteSessionId: 'remote-sync-fullchain',
                replayPending: true,
                ackReplayed: true,
            },
        });
        const syncResponse = await session.waitFor(
            syncFrom,
            (message) => message.type === 'sync_remote_session_response' && message.commandId === syncId,
            8_000,
        );
        const syncPayload = toRecord(syncResponse.payload);
        expect(syncPayload.success).toBe(true);
        expect(Number(syncPayload.replayedCount)).toBe(1);
        expect(Number(syncPayload.ackedCount)).toBe(1);

        await session.waitFor(
            syncFrom,
            (message) =>
                message.type === 'TASK_EVENT'
                && message.taskId === 'task-remote-sync-fullchain'
                && toString(toRecord(message.payload).action) === 'replayed_on_sync'
                && toString(toRecord(message.payload).deliveryId) === 'delivery-sync-fullchain-1',
            8_000,
        );

        const listAckedId = `cmd-sync-list-acked-${randomUUID()}`;
        const listAckedFrom = session.mark();
        session.send({
            id: listAckedId,
            timestamp: new Date().toISOString(),
            type: 'list_channel_delivery_events',
            payload: {
                remoteSessionId: 'remote-sync-fullchain',
                status: 'acked',
            },
        });
        const listAckedResponse = await session.waitFor(
            listAckedFrom,
            (message) => message.type === 'list_channel_delivery_events_response' && message.commandId === listAckedId,
            8_000,
        );
        const ackedEvents = Array.isArray(toRecord(listAckedResponse.payload).events)
            ? (toRecord(listAckedResponse.payload).events as unknown[]).map((item) => toRecord(item))
            : [];
        expect(ackedEvents.some((event) => toString(event.id) === 'delivery-sync-fullchain-1')).toBe(true);
    }, 30_000);

    test('recover_tasks dry-run is reachable in full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-recover-tasks-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const setCheckpointId = `cmd-recover-set-checkpoint-${randomUUID()}`;
        const setCheckpointFrom = session.mark();
        session.send({
            id: setCheckpointId,
            timestamp: new Date().toISOString(),
            type: 'set_task_checkpoint',
            payload: {
                taskId: 'task-recover-dryrun-fullchain',
                checkpointId: 'cp-recover-dryrun',
                label: 'recover dry run',
                reason: 'checkpoint',
                workspacePath: '/tmp/ws-recover-dryrun-fullchain',
            },
        });
        await session.waitFor(
            setCheckpointFrom,
            (message) => message.type === 'set_task_checkpoint_response' && message.commandId === setCheckpointId,
            8_000,
        );

        const recoverId = `cmd-recover-dryrun-${randomUUID()}`;
        const recoverFrom = session.mark();
        session.send({
            id: recoverId,
            timestamp: new Date().toISOString(),
            type: 'recover_tasks',
            payload: {
                workspacePath: '/tmp/ws-recover-dryrun-fullchain',
                mode: 'auto',
                dryRun: true,
            },
        });
        const recoverResponse = await session.waitFor(
            recoverFrom,
            (message) => message.type === 'recover_tasks_response' && message.commandId === recoverId,
            8_000,
        );
        const recoverPayload = toRecord(recoverResponse.payload);
        expect(recoverPayload.success).toBe(true);
        expect(recoverPayload.dryRun).toBe(true);
        expect(Number(recoverPayload.count)).toBeGreaterThanOrEqual(1);
        const items = Array.isArray(recoverPayload.items)
            ? recoverPayload.items.map((item) => toRecord(item))
            : [];
        expect(items.some((item) => toString(item.taskId) === 'task-recover-dryrun-fullchain')).toBe(true);
    }, 30_000);

    test('task runtime state commands expose checkpoint and retry contract in full chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-task-runtime-state-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const checkpointId = `cmd-set-checkpoint-${randomUUID()}`;
        const checkpointFrom = session.mark();
        session.send({
            id: checkpointId,
            timestamp: new Date().toISOString(),
            type: 'set_task_checkpoint',
            payload: {
                taskId: 'task-state-fullchain',
                checkpointId: 'cp-fullchain-1',
                label: 'Need review',
                reason: 'checkpoint',
                operationId: 'op-fullchain-checkpoint-1',
            },
        });
        const checkpointResponse = await session.waitFor(
            checkpointFrom,
            (message) => message.type === 'set_task_checkpoint_response' && message.commandId === checkpointId,
            8_000,
        );
        expect(toRecord(checkpointResponse.payload).success).toBe(true);

        const checkpointDedupId = `cmd-set-checkpoint-dedup-${randomUUID()}`;
        const checkpointDedupFrom = session.mark();
        session.send({
            id: checkpointDedupId,
            timestamp: new Date().toISOString(),
            type: 'set_task_checkpoint',
            payload: {
                taskId: 'task-state-fullchain',
                checkpointId: 'cp-fullchain-ignored',
                operationId: 'op-fullchain-checkpoint-1',
            },
        });
        const checkpointDedupResponse = await session.waitFor(
            checkpointDedupFrom,
            (message) => message.type === 'set_task_checkpoint_response' && message.commandId === checkpointDedupId,
            8_000,
        );
        expect(toRecord(checkpointDedupResponse.payload).deduplicated).toBe(true);

        const stateId = `cmd-get-task-state-${randomUUID()}`;
        const stateFrom = session.mark();
        session.send({
            id: stateId,
            timestamp: new Date().toISOString(),
            type: 'get_task_runtime_state',
            payload: {
                taskId: 'task-state-fullchain',
            },
        });
        const stateResponse = await session.waitFor(
            stateFrom,
            (message) => message.type === 'get_task_runtime_state_response' && message.commandId === stateId,
            8_000,
        );
        const state = toRecord(toRecord(stateResponse.payload).state);
        expect(toString(state.status)).toBe('suspended');
        expect(toString(toRecord(state.checkpoint).id)).toBe('cp-fullchain-1');
        expect(Number(state.checkpointVersion)).toBe(1);

        const checkpointConflictId = `cmd-set-checkpoint-conflict-${randomUUID()}`;
        const checkpointConflictFrom = session.mark();
        session.send({
            id: checkpointConflictId,
            timestamp: new Date().toISOString(),
            type: 'set_task_checkpoint',
            payload: {
                taskId: 'task-state-fullchain',
                checkpointId: 'cp-fullchain-2',
                operationId: 'op-fullchain-checkpoint-2',
                expectedCheckpointVersion: 0,
            },
        });
        const checkpointConflictResponse = await session.waitFor(
            checkpointConflictFrom,
            (message) => message.type === 'set_task_checkpoint_response' && message.commandId === checkpointConflictId,
            8_000,
        );
        expect(toString(toRecord(checkpointConflictResponse.payload).error)).toBe('checkpoint_version_conflict');

        const retryUnknownId = `cmd-retry-unknown-${randomUUID()}`;
        const retryUnknownFrom = session.mark();
        session.send({
            id: retryUnknownId,
            timestamp: new Date().toISOString(),
            type: 'retry_task',
            payload: {
                taskId: 'task-state-unknown',
            },
        });
        const retryUnknownResponse = await session.waitFor(
            retryUnknownFrom,
            (message) => message.type === 'retry_task_response' && message.commandId === retryUnknownId,
            8_000,
        );
        const retryUnknownPayload = toRecord(retryUnknownResponse.payload);
        expect(retryUnknownPayload.success).toBe(false);
        expect(toString(retryUnknownPayload.error)).toBe('task_not_found');
    }, 30_000);

    test('bootstrap_runtime_context enables doctor_preflight and runtime snapshot baseline', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-bootstrap-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const bootstrapCommandId = `cmd-bootstrap-${randomUUID()}`;
        const bootstrapFromIndex = session.mark();
        session.send({
            id: bootstrapCommandId,
            timestamp: new Date().toISOString(),
            type: 'bootstrap_runtime_context',
            payload: {
                runtimeContext: {
                    appDataDir: appDataDirInTest,
                    appDir: '/tmp/fullchain-app',
                    shell: '/bin/zsh',
                    resourceId: 'employee-bootstrap',
                },
            },
        });
        const bootstrapResponse = await session.waitFor(
            bootstrapFromIndex,
            (message) => message.type === 'bootstrap_runtime_context_response' && message.commandId === bootstrapCommandId,
            8_000,
        );
        expect(toRecord(bootstrapResponse.payload).success).toBe(true);

        const doctorCommandId = `cmd-doctor-${randomUUID()}`;
        const doctorFromIndex = session.mark();
        session.send({
            id: doctorCommandId,
            timestamp: new Date().toISOString(),
            type: 'doctor_preflight',
            payload: {},
        });
        const doctorResponse = await session.waitFor(
            doctorFromIndex,
            (message) => message.type === 'doctor_preflight_response' && message.commandId === doctorCommandId,
            8_000,
        );
        const doctorPayload = toRecord(doctorResponse.payload);
        expect(doctorPayload.success).toBe(true);
        const report = toRecord(doctorPayload.report);
        expect(report.runtime).toBe('mastra');
        expect(report.status).toBe('ok');
        expect(report.hasRuntimeContext).toBe(true);

        const snapshotCommandId = `cmd-snapshot-${randomUUID()}`;
        const snapshotFromIndex = session.mark();
        session.send({
            id: snapshotCommandId,
            timestamp: new Date().toISOString(),
            type: 'get_runtime_snapshot',
            payload: {},
        });
        const snapshotResponse = await session.waitFor(
            snapshotFromIndex,
            (message) => message.type === 'get_runtime_snapshot_response' && message.commandId === snapshotCommandId,
            8_000,
        );
        const snapshotPayload = toRecord(snapshotResponse.payload);
        expect(snapshotPayload.success).toBe(true);
        const snapshot = toRecord(snapshotPayload.snapshot);
        expect(Number(snapshot.count)).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(snapshot.tasks)).toBe(true);
    }, 30_000);

    test('scheduled start_task inherits bootstrap resourceId in runtime snapshot', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-resource-bootstrap-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const resourceId = `employee-bootstrap-${randomUUID()}`;
        const bootstrapCommandId = `cmd-bootstrap-${randomUUID()}`;
        const bootstrapFromIndex = session.mark();
        session.send({
            id: bootstrapCommandId,
            timestamp: new Date().toISOString(),
            type: 'bootstrap_runtime_context',
            payload: {
                runtimeContext: {
                    appDataDir: appDataDirInTest,
                    resourceId,
                },
            },
        });
        await session.waitFor(
            bootstrapFromIndex,
            (message) => message.type === 'bootstrap_runtime_context_response' && message.commandId === bootstrapCommandId,
            8_000,
        );

        const taskId = `task-resource-bootstrap-${randomUUID()}`;
        const startCommandId = `cmd-start-${randomUUID()}`;
        const startFromIndex = session.mark();
        session.send({
            id: startCommandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'hydration-reminder',
                userQuery: '10分钟后提醒我喝水',
                context: {
                    workspacePath: '/tmp/resource-bootstrap-fullchain',
                },
            },
        });
        await session.waitFor(
            startFromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === startCommandId,
            10_000,
        );
        await session.waitFor(
            startFromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            12_000,
        );

        const snapshotCommandId = `cmd-snapshot-${randomUUID()}`;
        const snapshotFromIndex = session.mark();
        session.send({
            id: snapshotCommandId,
            timestamp: new Date().toISOString(),
            type: 'get_runtime_snapshot',
            payload: {},
        });
        const snapshotResponse = await session.waitFor(
            snapshotFromIndex,
            (message) => message.type === 'get_runtime_snapshot_response' && message.commandId === snapshotCommandId,
            8_000,
        );
        const snapshot = toRecord(toRecord(snapshotResponse.payload).snapshot);
        const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks.map((task) => toRecord(task)) : [];
        const task = tasks.find((item) => toString(item.taskId) === taskId);
        expect(task).toBeDefined();
        expect(toString(task?.status)).toBe('scheduled');
        expect(toString(task?.resourceId)).toBe(resourceId);
    }, 30_000);

    test('start_task resourceId override takes precedence over bootstrap resourceId', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-resource-override-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const bootstrapCommandId = `cmd-bootstrap-${randomUUID()}`;
        const bootstrapFromIndex = session.mark();
        session.send({
            id: bootstrapCommandId,
            timestamp: new Date().toISOString(),
            type: 'bootstrap_runtime_context',
            payload: {
                runtimeContext: {
                    appDataDir: appDataDirInTest,
                    resourceId: 'employee-bootstrap',
                },
            },
        });
        await session.waitFor(
            bootstrapFromIndex,
            (message) => message.type === 'bootstrap_runtime_context_response' && message.commandId === bootstrapCommandId,
            8_000,
        );

        const taskId = `task-resource-override-${randomUUID()}`;
        const resourceId = `employee-command-${randomUUID()}`;
        const startCommandId = `cmd-start-${randomUUID()}`;
        const startFromIndex = session.mark();
        session.send({
            id: startCommandId,
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {
                taskId,
                title: 'override-reminder',
                userQuery: '10分钟后提醒我站起来活动',
                resourceId,
                context: {
                    workspacePath: '/tmp/resource-override-fullchain',
                },
            },
        });
        await session.waitFor(
            startFromIndex,
            (message) => message.type === 'start_task_response' && message.commandId === startCommandId,
            10_000,
        );
        await session.waitFor(
            startFromIndex,
            (message) =>
                message.type === 'TASK_FINISHED'
                && message.taskId === taskId
                && toString(toRecord(message.payload).finishReason) === 'scheduled',
            12_000,
        );

        const snapshotCommandId = `cmd-snapshot-${randomUUID()}`;
        const snapshotFromIndex = session.mark();
        session.send({
            id: snapshotCommandId,
            timestamp: new Date().toISOString(),
            type: 'get_runtime_snapshot',
            payload: {},
        });
        const snapshotResponse = await session.waitFor(
            snapshotFromIndex,
            (message) => message.type === 'get_runtime_snapshot_response' && message.commandId === snapshotCommandId,
            8_000,
        );
        const snapshot = toRecord(toRecord(snapshotResponse.payload).snapshot);
        const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks.map((task) => toRecord(task)) : [];
        const task = tasks.find((item) => toString(item.taskId) === taskId);
        expect(task).toBeDefined();
        expect(toString(task?.resourceId)).toBe(resourceId);
    }, 30_000);

    test('workspace lifecycle commands are handled through full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-workspace-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const listBeforeId = `cmd-list-workspaces-before-${randomUUID()}`;
        const listBeforeIndex = session.mark();
        session.send({
            id: listBeforeId,
            timestamp: new Date().toISOString(),
            type: 'list_workspaces',
            payload: {},
        });
        const listBefore = await session.waitFor(
            listBeforeIndex,
            (message) => message.type === 'list_workspaces_response' && message.commandId === listBeforeId,
            8_000,
        );
        const initialWorkspaces = Array.isArray(toRecord(listBefore.payload).workspaces)
            ? toRecord(listBefore.payload).workspaces as unknown[]
            : [];
        expect(initialWorkspaces.length).toBe(0);

        const createId = `cmd-create-workspace-${randomUUID()}`;
        const createIndex = session.mark();
        session.send({
            id: createId,
            timestamp: new Date().toISOString(),
            type: 'create_workspace',
            payload: {
                name: 'Full Chain Workspace',
                path: 'default',
            },
        });
        const created = await session.waitFor(
            createIndex,
            (message) => message.type === 'create_workspace_response' && message.commandId === createId,
            8_000,
        );
        const createPayload = toRecord(created.payload);
        expect(createPayload.success).toBe(true);
        const workspace = toRecord(createPayload.workspace);
        const workspaceId = toString(workspace.id);
        expect(workspaceId).not.toBe('');
        expect(toString(workspace.path)).toContain(path.join(appDataDirInTest, 'workspaces'));

        const updateId = `cmd-update-workspace-${randomUUID()}`;
        const updateIndex = session.mark();
        session.send({
            id: updateId,
            timestamp: new Date().toISOString(),
            type: 'update_workspace',
            payload: {
                id: workspaceId,
                updates: {
                    name: 'Full Chain Workspace Updated',
                },
            },
        });
        const updated = await session.waitFor(
            updateIndex,
            (message) => message.type === 'update_workspace_response' && message.commandId === updateId,
            8_000,
        );
        expect(toRecord(updated.payload).success).toBe(true);
        expect(toString(toRecord(toRecord(updated.payload).workspace).name)).toBe('Full Chain Workspace Updated');

        const deleteId = `cmd-delete-workspace-${randomUUID()}`;
        const deleteIndex = session.mark();
        session.send({
            id: deleteId,
            timestamp: new Date().toISOString(),
            type: 'delete_workspace',
            payload: {
                id: workspaceId,
            },
        });
        const deleted = await session.waitFor(
            deleteIndex,
            (message) => message.type === 'delete_workspace_response' && message.commandId === deleteId,
            8_000,
        );
        expect(toRecord(deleted.payload).success).toBe(true);
    }, 30_000);

    test('install_from_github supports local skill source through full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-install-github-fullchain-'));
        const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-install-github-workspace-'));
        const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-install-github-source-'));
        const skillSourceDir = path.join(sourceRoot, 'github-skill-local');
        fs.mkdirSync(skillSourceDir, { recursive: true });
        fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), `---
name: github-local-skill
version: 1.0.0
description: skill installed from local source
---

# github-local-skill
`);

        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const installId = `cmd-install-github-skill-${randomUUID()}`;
        const installFrom = session.mark();
        session.send({
            id: installId,
            timestamp: new Date().toISOString(),
            type: 'install_from_github',
            payload: {
                workspacePath,
                source: skillSourceDir,
                targetType: 'skill',
            },
        });
        const installResponse = await session.waitFor(
            installFrom,
            (message) => message.type === 'install_from_github_response' && message.commandId === installId,
            8_000,
        );
        const installPayload = toRecord(installResponse.payload);
        expect(installPayload.success).toBe(true);
        expect(toString(installPayload.skillId)).toBe('github-local-skill');

        const listSkillsId = `cmd-list-skills-${randomUUID()}`;
        const listSkillsFrom = session.mark();
        session.send({
            id: listSkillsId,
            timestamp: new Date().toISOString(),
            type: 'list_claude_skills',
            payload: {
                includeDisabled: true,
            },
        });
        const listSkillsResponse = await session.waitFor(
            listSkillsFrom,
            (message) => message.type === 'list_claude_skills_response' && message.commandId === listSkillsId,
            8_000,
        );
        const skills = Array.isArray(toRecord(listSkillsResponse.payload).skills)
            ? (toRecord(listSkillsResponse.payload).skills as unknown[]).map((item) => toRecord(item))
            : [];
        expect(skills.some((item) => toString(toRecord(item.manifest).id) === 'github-local-skill')).toBe(true);
    }, 30_000);

    test('capability and directive commands remain reachable in full stdio chain', async () => {
        appDataDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-capability-fullchain-'));
        session = new MastraStdioSession({
            env: buildNoProviderKeyEnv(appDataDirInTest),
        });
        await session.start();

        const listToolpacksId = `cmd-list-toolkpacks-${randomUUID()}`;
        const listToolpacksIndex = session.mark();
        session.send({
            id: listToolpacksId,
            timestamp: new Date().toISOString(),
            type: 'list_toolpacks',
            payload: {
                includeDisabled: true,
            },
        });
        const toolpacksResponse = await session.waitFor(
            listToolpacksIndex,
            (message) => message.type === 'list_toolpacks_response' && message.commandId === listToolpacksId,
            8_000,
        );
        expect(Array.isArray(toRecord(toolpacksResponse.payload).toolpacks)).toBe(true);

        const listSkillsId = `cmd-list-skills-${randomUUID()}`;
        const listSkillsIndex = session.mark();
        session.send({
            id: listSkillsId,
            timestamp: new Date().toISOString(),
            type: 'list_claude_skills',
            payload: {
                includeDisabled: true,
            },
        });
        const skillsResponse = await session.waitFor(
            listSkillsIndex,
            (message) => message.type === 'list_claude_skills_response' && message.commandId === listSkillsId,
            8_000,
        );
        expect(Array.isArray(toRecord(skillsResponse.payload).skills)).toBe(true);

        const directiveId = `fullchain-directive-${randomUUID()}`;
        const upsertId = `cmd-upsert-directive-${randomUUID()}`;
        const upsertIndex = session.mark();
        session.send({
            id: upsertId,
            timestamp: new Date().toISOString(),
            type: 'upsert_directive',
            payload: {
                directive: {
                    id: directiveId,
                    name: 'Full Chain Directive',
                    content: 'content',
                    enabled: true,
                    priority: 10,
                },
            },
        });
        const upsertResponse = await session.waitFor(
            upsertIndex,
            (message) => message.type === 'upsert_directive_response' && message.commandId === upsertId,
            8_000,
        );
        expect(toRecord(upsertResponse.payload).success).toBe(true);

        const listDirectivesId = `cmd-list-directives-${randomUUID()}`;
        const listDirectivesIndex = session.mark();
        session.send({
            id: listDirectivesId,
            timestamp: new Date().toISOString(),
            type: 'list_directives',
            payload: {},
        });
        const listDirectivesResponse = await session.waitFor(
            listDirectivesIndex,
            (message) => message.type === 'list_directives_response' && message.commandId === listDirectivesId,
            8_000,
        );
        const directives = Array.isArray(toRecord(listDirectivesResponse.payload).directives)
            ? toRecord(listDirectivesResponse.payload).directives.map((item) => toRecord(item))
            : [];
        expect(directives.some((item) => toString(item.id) === directiveId)).toBe(true);

        const removeDirectiveId = `cmd-remove-directive-${randomUUID()}`;
        const removeDirectiveIndex = session.mark();
        session.send({
            id: removeDirectiveId,
            timestamp: new Date().toISOString(),
            type: 'remove_directive',
            payload: {
                directiveId,
            },
        });
        const removeDirectiveResponse = await session.waitFor(
            removeDirectiveIndex,
            (message) => message.type === 'remove_directive_response' && message.commandId === removeDirectiveId,
            8_000,
        );
        expect(toRecord(removeDirectiveResponse.payload).success).toBe(true);

        const unsupportedId = `cmd-governance-${randomUUID()}`;
        const unsupportedIndex = session.mark();
        session.send({
            id: unsupportedId,
            timestamp: new Date().toISOString(),
            type: 'approve_extension_governance',
            payload: {},
        });
        const unsupportedResponse = await session.waitFor(
            unsupportedIndex,
            (message) => message.type === 'approve_extension_governance_response' && message.commandId === unsupportedId,
            8_000,
        );
        const unsupportedPayload = toRecord(unsupportedResponse.payload);
        expect(unsupportedPayload.success).toBe(false);
        expect(unsupportedPayload.error).toBe('unsupported_in_single_path_runtime');
    }, 30_000);
});

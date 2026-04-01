import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MastraRemoteSessionStore } from '../src/mastra/remoteSessionStore';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('mastra remote session store', () => {
    test('upsert + heartbeat + close lifecycle persists and reloads', () => {
        const root = createTempDir('coworkany-remote-session-store-');
        const filePath = path.join(root, 'mastra-remote-sessions.json');
        const store = new MastraRemoteSessionStore(filePath);

        const linked = store.upsertLink({
            remoteSessionId: 'remote-1',
            taskId: 'task-1',
            channel: 'slack',
        });
        expect(linked.success).toBe(true);
        expect(linked.state?.status).toBe('active');

        const heartbeat = store.heartbeat('remote-1', { ping: true });
        expect(heartbeat.success).toBe(true);
        expect(heartbeat.state?.status).toBe('active');

        const closed = store.close('remote-1');
        expect(closed.success).toBe(true);
        expect(closed.state?.status).toBe('closed');

        const reloaded = new MastraRemoteSessionStore(filePath);
        const sessions = reloaded.list({ taskId: 'task-1' });
        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.status).toBe('closed');
        expect(sessions[0]?.channel).toBe('slack');
    });

    test('prevents active session id conflict across tasks', () => {
        const root = createTempDir('coworkany-remote-session-store-conflict-');
        const filePath = path.join(root, 'mastra-remote-sessions.json');
        const store = new MastraRemoteSessionStore(filePath);

        const first = store.upsertLink({
            remoteSessionId: 'remote-conflict',
            taskId: 'task-a',
        });
        expect(first.success).toBe(true);

        const conflict = store.upsertLink({
            remoteSessionId: 'remote-conflict',
            taskId: 'task-b',
        });
        expect(conflict.success).toBe(false);
        expect(conflict.conflict).toBe(true);
        expect(conflict.state?.taskId).toBe('task-a');
    });

    test('channel delivery queue supports pending list + ack + reload', () => {
        const root = createTempDir('coworkany-channel-delivery-store-');
        const filePath = path.join(root, 'mastra-remote-sessions.json');
        const store = new MastraRemoteSessionStore(filePath);

        store.upsertLink({
            remoteSessionId: 'remote-delivery-1',
            taskId: 'task-delivery-1',
            channel: 'slack',
        });

        const first = store.enqueueChannelEvent({
            taskId: 'task-delivery-1',
            remoteSessionId: 'remote-delivery-1',
            channel: 'slack',
            eventType: 'mention',
            content: 'first pending',
            eventId: 'delivery-1',
        });
        expect(first.success).toBe(true);
        expect(first.event?.status).toBe('pending');

        const second = store.enqueueChannelEvent({
            taskId: 'task-delivery-1',
            remoteSessionId: 'remote-delivery-1',
            channel: 'slack',
            eventType: 'mention',
            content: 'second pending',
            eventId: 'delivery-2',
        });
        expect(second.success).toBe(true);

        const pendingBeforeAck = store.listChannelEvents({
            taskId: 'task-delivery-1',
            status: 'pending',
        });
        expect(pendingBeforeAck).toHaveLength(2);

        const ack = store.ackChannelEvent({
            eventId: 'delivery-1',
            taskId: 'task-delivery-1',
            remoteSessionId: 'remote-delivery-1',
            metadata: {
                from: 'desktop',
            },
        });
        expect(ack.success).toBe(true);
        expect(ack.event?.status).toBe('acked');

        const pendingAfterAck = store.listChannelEvents({
            taskId: 'task-delivery-1',
            status: 'pending',
        });
        expect(pendingAfterAck).toHaveLength(1);
        expect(pendingAfterAck[0]?.id).toBe('delivery-2');

        const reloaded = new MastraRemoteSessionStore(filePath);
        const ackedAfterReload = reloaded.listChannelEvents({
            taskId: 'task-delivery-1',
            status: 'acked',
        });
        expect(ackedAfterReload).toHaveLength(1);
        expect(ackedAfterReload[0]?.id).toBe('delivery-1');
        expect(ackedAfterReload[0]?.ackMetadata?.from).toBe('desktop');
    });

    test('channel delivery enqueue is idempotent and marks delivery attempts', () => {
        const root = createTempDir('coworkany-channel-delivery-dedupe-');
        const filePath = path.join(root, 'mastra-remote-sessions.json');
        const store = new MastraRemoteSessionStore(filePath);

        const first = store.enqueueChannelEvent({
            taskId: 'task-delivery-idempotent',
            remoteSessionId: 'remote-delivery-idempotent',
            channel: 'slack',
            eventType: 'mention',
            content: 'hello',
            eventId: 'delivery-fixed-id',
        });
        expect(first.success).toBe(true);
        expect(first.deduplicated).toBe(false);

        const duplicate = store.enqueueChannelEvent({
            taskId: 'task-delivery-idempotent',
            remoteSessionId: 'remote-delivery-idempotent',
            channel: 'slack',
            eventType: 'mention',
            content: 'hello again',
            eventId: 'delivery-fixed-id',
        });
        expect(duplicate.success).toBe(true);
        expect(duplicate.deduplicated).toBe(true);

        const pending = store.listChannelEvents({
            taskId: 'task-delivery-idempotent',
            status: 'pending',
        });
        expect(pending).toHaveLength(1);
        expect(pending[0]?.id).toBe('delivery-fixed-id');

        const delivered = store.markChannelEventDelivered({
            eventId: 'delivery-fixed-id',
            taskId: 'task-delivery-idempotent',
            remoteSessionId: 'remote-delivery-idempotent',
        });
        expect(delivered.success).toBe(true);
        expect(delivered.event?.deliveryAttempts).toBe(1);
        expect(typeof delivered.event?.lastDeliveredAt).toBe('string');

        const reloaded = new MastraRemoteSessionStore(filePath);
        const reloadedEvent = reloaded.getChannelEvent('delivery-fixed-id');
        expect(reloadedEvent?.deliveryAttempts).toBe(1);
    });
});

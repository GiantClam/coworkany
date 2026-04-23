import { describe, expect, test } from 'bun:test';
import { createEntrypointRemoteSessionRecords } from '../src/mastra/entrypointRemoteSessionRecords';

describe('entrypointRemoteSessionRecords', () => {
    test('fallback mode handles remote session upsert/heartbeat/close via task binding resolver', () => {
        const bindings = new Map<string, string>([['remote-1', 'task-1']]);
        const records = createEntrypointRemoteSessionRecords({
            resolveTaskIdForRemoteSessionId: (remoteSessionId) => bindings.get(remoteSessionId),
            getNowIso: () => '2026-04-23T00:00:00.000Z',
            getString: (value) => (typeof value === 'string' && value.trim().length > 0 ? value : null),
            createId: () => 'id-1',
        });

        const opened = records.upsertRemoteSessionRecord({
            remoteSessionId: 'remote-1',
            taskId: 'task-1',
            channel: 'terminal',
        });
        expect(opened.success).toBe(true);
        expect(opened.state?.status).toBe('active');

        const heartbeatMissing = records.heartbeatRemoteSessionRecord('remote-missing');
        expect(heartbeatMissing.success).toBe(false);

        const heartbeat = records.heartbeatRemoteSessionRecord('remote-1', { tenantId: 'tenant-1' });
        expect(heartbeat.success).toBe(true);
        expect(heartbeat.state?.metadata).toEqual({ tenantId: 'tenant-1' });

        const closed = records.closeRemoteSessionRecord('remote-1');
        expect(closed.success).toBe(true);
        expect(closed.state?.status).toBe('closed');
    });

    test('fallback mode enforces delivery event dedupe/requeue/ack semantics', () => {
        const records = createEntrypointRemoteSessionRecords({
            resolveTaskIdForRemoteSessionId: () => 'task-1',
            getNowIso: () => '2026-04-23T00:00:00.000Z',
            getString: (value) => (typeof value === 'string' && value.trim().length > 0 ? value : null),
            createId: () => 'id-1',
        });

        const first = records.enqueueChannelDeliveryEvent({
            taskId: 'task-1',
            remoteSessionId: 'remote-1',
            channel: 'terminal',
            eventType: 'stdout',
            content: 'hello',
            eventId: 'event-1',
        });
        expect(first.deduplicated).toBe(false);
        expect(first.requeued).toBe(false);

        const duplicate = records.enqueueChannelDeliveryEvent({
            taskId: 'task-1',
            remoteSessionId: 'remote-1',
            channel: 'terminal',
            eventType: 'stdout',
            content: 'hello',
            eventId: 'event-1',
        });
        expect(duplicate.deduplicated).toBe(true);
        expect(duplicate.requeued).toBe(false);

        const requeued = records.enqueueChannelDeliveryEvent({
            taskId: 'task-1',
            remoteSessionId: 'remote-1',
            channel: 'terminal',
            eventType: 'stdout',
            content: 'hello-again',
            eventId: 'event-1',
            forceRequeue: true,
        });
        expect(requeued.deduplicated).toBe(false);
        expect(requeued.requeued).toBe(true);

        const marked = records.markChannelDeliveryDelivered({ eventId: 'event-1', taskId: 'task-1' });
        expect(marked.success).toBe(true);
        expect(marked.event?.deliveryAttempts).toBe(1);

        const mismatchAck = records.ackChannelDeliveryEvent({
            eventId: 'event-1',
            taskId: 'task-2',
        });
        expect(mismatchAck.success).toBe(false);

        const acked = records.ackChannelDeliveryEvent({
            eventId: 'event-1',
            taskId: 'task-1',
            metadata: { source: 'test' },
        });
        expect(acked.success).toBe(true);
        expect(acked.event?.status).toBe('acked');
        expect(acked.event?.ackMetadata).toEqual({ source: 'test' });
    });

    test('store-backed mode delegates record and event operations to store', () => {
        const callLog: string[] = [];
        const store = {
            upsertLink: (input: {
                remoteSessionId: string;
                taskId: string;
                channel?: string;
                metadata?: Record<string, unknown>;
            }) => {
                callLog.push('upsertLink');
                return {
                    success: true,
                    state: {
                        remoteSessionId: input.remoteSessionId,
                        taskId: input.taskId,
                        channel: input.channel,
                        status: 'active' as const,
                        linkedAt: '2026-04-23T00:00:00.000Z',
                        lastSeenAt: '2026-04-23T00:00:00.000Z',
                        metadata: input.metadata,
                    },
                };
            },
            heartbeat: () => {
                callLog.push('heartbeat');
                return { success: true };
            },
            close: () => {
                callLog.push('close');
                return { success: true };
            },
            enqueueChannelEvent: () => {
                callLog.push('enqueueChannelEvent');
                return {
                    success: true,
                    event: {
                        id: 'event-store',
                        taskId: 'task-1',
                        remoteSessionId: 'remote-1',
                        channel: 'terminal',
                        eventType: 'stdout',
                        content: 'store',
                        injectedAt: '2026-04-23T00:00:00.000Z',
                        status: 'pending' as const,
                        deliveryAttempts: 0,
                    },
                    deduplicated: false,
                    requeued: false,
                };
            },
            listChannelEvents: () => {
                callLog.push('listChannelEvents');
                return [];
            },
            ackChannelEvent: () => {
                callLog.push('ackChannelEvent');
                return { success: true };
            },
            getChannelEvent: () => {
                callLog.push('getChannelEvent');
                return undefined;
            },
            markChannelEventDelivered: () => {
                callLog.push('markChannelEventDelivered');
                return { success: true };
            },
        };
        const records = createEntrypointRemoteSessionRecords({
            remoteSessionStore: store,
            resolveTaskIdForRemoteSessionId: () => undefined,
            getNowIso: () => '2026-04-23T00:00:00.000Z',
            getString: (value) => (typeof value === 'string' && value.trim().length > 0 ? value : null),
            createId: () => 'id-1',
        });

        records.upsertRemoteSessionRecord({ remoteSessionId: 'remote-1', taskId: 'task-1' });
        records.heartbeatRemoteSessionRecord('remote-1');
        records.closeRemoteSessionRecord('remote-1');
        records.enqueueChannelDeliveryEvent({
            taskId: 'task-1',
            channel: 'terminal',
            eventType: 'stdout',
        });
        records.listChannelDeliveryEvents();
        records.ackChannelDeliveryEvent({ eventId: 'event-store' });
        records.getChannelDeliveryEvent('event-store');
        records.markChannelDeliveryDelivered({ eventId: 'event-store' });

        expect(callLog).toEqual([
            'upsertLink',
            'heartbeat',
            'close',
            'enqueueChannelEvent',
            'listChannelEvents',
            'ackChannelEvent',
            'getChannelEvent',
            'markChannelEventDelivered',
        ]);
    });
});

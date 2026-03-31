interface SeedPendingApprovalInput {
    taskId: string;
    requestId: string;
    effectType?: string;
    userContent?: string;
    assistantContent?: string;
    title?: string;
}

export async function seedPendingApprovalSession(page: any, input: SeedPendingApprovalInput) {
    await page.evaluate(async ({
        taskId,
        requestId,
        effectType,
        userContent,
        assistantContent,
        title,
    }) => {
        const storeModule = await import('/src/stores/taskEvents/index.ts');
        const store = storeModule.useTaskEventStore.getState();
        const now = '2026-03-31T12:00:00.000Z';
        const eventBase = { taskId, timestamp: now };

        store.reset();
        store.ensureSession(taskId, {
            title: title ?? 'assistant-ui approval e2e',
            status: 'running',
            taskMode: 'immediate_task',
            createdAt: now,
            updatedAt: now,
        }, true);
        store.addEvents([
            {
                ...eventBase,
                id: `${taskId}-event-user`,
                sequence: 1,
                type: 'CHAT_MESSAGE',
                payload: {
                    role: 'user',
                    content: userContent ?? '请执行高风险命令',
                },
            },
            {
                ...eventBase,
                id: `${taskId}-event-assistant`,
                sequence: 2,
                type: 'CHAT_MESSAGE',
                payload: {
                    role: 'assistant',
                    content: assistantContent ?? '执行前需要审批',
                },
            },
            {
                ...eventBase,
                id: `${taskId}-event-effect-requested`,
                sequence: 3,
                type: 'EFFECT_REQUESTED',
                payload: {
                    request: {
                        id: requestId,
                        effectType: effectType ?? 'shell:write',
                    },
                    riskLevel: 9,
                },
            },
        ]);
        store.setActiveTask(taskId);
    }, input);
}

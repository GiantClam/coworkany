import { expect, type Locator, type Page } from '@playwright/test';

const INPUT_SELECTORS = [
    '.chat-input',
    'textarea.chat-input',
    'input[placeholder="New instructions..."]',
    'input[placeholder*="instructions"]',
    'input[placeholder*="指令"]',
    '.chat-input input',
    '.chat-input textarea',
    'textarea',
    'input[type="text"]',
];

export type TerminalTaskStatus = 'finished' | 'failed' | 'cancelled' | 'idle';

async function readActiveTaskStatus(page: Page): Promise<string | null> {
    return await page.evaluate(async () => {
        try {
            const storeModule = await import('/src/stores/taskEvents/index.ts');
            const state = storeModule.useTaskEventStore.getState();
            const activeTaskId = state.activeTaskId;
            if (!activeTaskId) {
                return null;
            }
            const session = state.getSession(activeTaskId);
            if (!session || typeof session.status !== 'string') {
                return null;
            }
            return session.status;
        } catch {
            return null;
        }
    });
}

export async function findVisibleChatInput(
    page: Page,
    timeoutMs = 1_200,
): Promise<Locator | null> {
    for (const selector of INPUT_SELECTORS) {
        const locator = page.locator(selector).first();
        const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
        if (visible) {
            return locator;
        }
    }
    return null;
}

export async function waitForActiveTaskTerminalStatus(
    page: Page,
    timeoutMs = 90_000,
    accepted: TerminalTaskStatus[] = ['finished', 'failed', 'cancelled', 'idle'],
): Promise<TerminalTaskStatus> {
    const acceptedStatuses = new Set(accepted);
    let terminal: TerminalTaskStatus | null = null;

    await expect.poll(
        async () => {
            const status = await readActiveTaskStatus(page);
            if (status && acceptedStatuses.has(status as TerminalTaskStatus)) {
                terminal = status as TerminalTaskStatus;
                return true;
            }
            return false;
        },
        {
            timeout: timeoutMs,
            message: `active task should reach terminal status (${Array.from(acceptedStatuses).join(', ')})`,
        },
    ).toBe(true);

    return terminal ?? 'idle';
}

export async function assertChatInputEditable(
    page: Page,
    timeoutMs = 20_000,
): Promise<void> {
    await expect.poll(
        async () => {
            const input = await findVisibleChatInput(page, 500);
            if (!input) {
                return false;
            }
            const disabled = await input.isDisabled().catch(() => true);
            const readonlyAttr = await input.getAttribute('readonly').catch(() => 'readonly');
            const isReadonly = readonlyAttr !== null;
            return !disabled && !isReadonly;
        },
        {
            timeout: timeoutMs,
            message: 'chat input should be editable (not disabled and not readonly)',
        },
    ).toBe(true);
}

export async function assertChatInputEditableAfterTaskTerminal(
    page: Page,
    options?: {
        terminalTimeoutMs?: number;
        editableTimeoutMs?: number;
        acceptedStatuses?: TerminalTaskStatus[];
    },
): Promise<TerminalTaskStatus> {
    const terminal = await waitForActiveTaskTerminalStatus(
        page,
        options?.terminalTimeoutMs,
        options?.acceptedStatuses,
    );
    await assertChatInputEditable(page, options?.editableTimeoutMs);
    return terminal;
}

import { useTaskEventStore } from '../stores/useTaskEventStore';
import type { SkillConfigCardData, TaskEvent } from '../types';

const FALLBACK_SKILL_CONFIG_TASK_ID = 'global';

interface SkillConfigSource {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    requiredEnv?: unknown;
    source?: unknown;
}

function normalizeRequiredEnv(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .map((entry) => String(entry).trim())
        .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index);
}

export function buildSkillConfigCardData(raw: SkillConfigSource | null | undefined): SkillConfigCardData | null {
    if (!raw) {
        return null;
    }

    const skillId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;
    const skillName = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : skillId;
    const requiredEnv = normalizeRequiredEnv(raw.requiredEnv);

    if (!skillId || !skillName || requiredEnv.length === 0) {
        return null;
    }

    return {
        skillId,
        skillName,
        requiredEnv,
        source: typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : undefined,
    };
}

export function buildSkillConfigPromptFromToolResult(result: string | Record<string, unknown> | null | undefined): SkillConfigCardData | null {
    if (!result) {
        return null;
    }

    const structured = typeof result === 'string'
        ? (() => {
            try {
                return JSON.parse(result) as Record<string, unknown>;
            } catch {
                return null;
            }
        })()
        : result;

    if (!structured || typeof structured !== 'object') {
        return null;
    }

    const skill = buildSkillConfigCardData(structured.skill as SkillConfigSource | undefined);
    if (skill) {
        return skill;
    }

    return null;
}

export function injectSkillConfigPrompt(taskId: string | null | undefined, card: SkillConfigCardData): void {
    const state = useTaskEventStore.getState();
    const targetTaskId = taskId ?? state.activeTaskId ?? FALLBACK_SKILL_CONFIG_TASK_ID;
    const session = state.sessions.get(targetTaskId);
    const alreadyInjected = session?.events.some((event) => {
        if (event.type !== 'CHAT_MESSAGE') {
            return false;
        }
        const payload = event.payload as { skillConfigCard?: SkillConfigCardData };
        return payload.skillConfigCard?.skillId === card.skillId;
    }) ?? false;

    if (!state.activeTaskId) {
        state.setActiveTask(targetTaskId);
    }

    if (alreadyInjected) {
        return;
    }

    state.addEvent({
        id: `skill-config:${targetTaskId}:${card.skillId}:${Date.now()}`,
        taskId: targetTaskId,
        timestamp: new Date().toISOString(),
        sequence: (session?.events.length ?? 0) + 1,
        type: 'CHAT_MESSAGE',
        payload: {
            role: 'system',
            content: `Configure ${card.skillName} to continue.`,
            skillConfigCard: card,
        },
    } satisfies TaskEvent);
}

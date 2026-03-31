import type { ThreadMessageLike } from '@assistant-ui/react';
import type { TimelineTurnRound } from '../Timeline/viewModels/turnRounds';

export interface AssistantUiStructuredTool {
    toolName: string;
    status: 'running' | 'success' | 'failed';
    inputSummary?: string;
    resultSummary?: string;
}

export interface AssistantUiStructuredApproval {
    requestId: string;
    effectType: string;
    risk: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    decision: 'pending' | 'approved' | 'denied';
    blocking: boolean;
}

export interface AssistantUiStructuredTask {
    title: string;
    status: 'idle' | 'running' | 'finished' | 'failed';
    progress?: {
        completed: number;
        total: number;
    };
}

export interface AssistantUiStructuredPatch {
    filePath: string;
    status: 'proposed' | 'applied' | 'rejected';
}

export interface AssistantUiStructuredPayload {
    runtime?: {
        pendingLabel?: string;
    };
    tools: AssistantUiStructuredTool[];
    approvals: AssistantUiStructuredApproval[];
    task?: AssistantUiStructuredTask;
    patches: AssistantUiStructuredPatch[];
}

export interface AssistantUiExternalMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    text: string;
    timestamp: string;
    turnId: string;
    source: 'user_message' | 'assistant_turn';
    cardCounts?: {
        tools: number;
        approvals: number;
        tasks: number;
        patches: number;
    };
    structured?: AssistantUiStructuredPayload;
}

export interface AssistantUiProjectionOptions {
    pendingLabel?: string;
}

function normalizeText(value: string | undefined | null): string {
    return typeof value === 'string' ? value.trim() : '';
}

function toUniqueLines(lines: string[]): string[] {
    const next: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
        const normalized = normalizeText(line);
        if (!normalized) {
            continue;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        next.push(normalized);
    }
    return next;
}

function buildAssistantTurnText(round: TimelineTurnRound): string {
    if (!round.assistantTurn) {
        return '';
    }

    const turn = round.assistantTurn;
    const messageLines = toUniqueLines([
        ...(turn.lead ? [turn.lead] : []),
        ...turn.messages,
    ]);
    const runtimeLines = toUniqueLines(turn.systemEvents ?? []);
    const sections: string[] = [];
    const taskCardResultLines = turn.taskCard
        ? toUniqueLines([
            normalizeText(turn.taskCard.result?.summary),
            normalizeText(turn.taskCard.result?.error),
            normalizeText(turn.taskCard.result?.suggestion),
        ])
        : [];
    const taskCardSectionLines = turn.taskCard
        ? toUniqueLines(turn.taskCard.sections.flatMap((section) => section.lines))
        : [];

    if (messageLines.length > 0) {
        sections.push(messageLines.join('\n\n'));
    }
    if (taskCardResultLines.length > 0) {
        sections.push(taskCardResultLines.join('\n\n'));
    } else if (messageLines.length === 0 && taskCardSectionLines.length > 0) {
        sections.push(taskCardSectionLines.join('\n\n'));
    }
    if (runtimeLines.length > 0) {
        sections.push(`Runtime:\n${runtimeLines.map((line) => `- ${line}`).join('\n')}`);
    }

    const tools = turn.toolCalls?.length ?? 0;
    const approvals = turn.effectRequests?.length ?? 0;
    const tasks = turn.taskCard ? 1 : 0;
    const patches = turn.patches?.length ?? 0;
    const structuredCounts = [
        tools > 0 ? `Tools ${tools}` : '',
        approvals > 0 ? `Approvals ${approvals}` : '',
        tasks > 0 ? 'Task 1' : '',
        patches > 0 ? `Patches ${patches}` : '',
    ].filter((line) => line.length > 0);
    if (structuredCounts.length > 0) {
        sections.push(`Structured cards: ${structuredCounts.join(' | ')}`);
    }

    return sections.join('\n\n').trim();
}

function buildStructuredFallbackText(structured: AssistantUiStructuredPayload): string {
    const segments: string[] = [];
    if (structured.tools.length > 0) {
        segments.push(`Tools ${structured.tools.length}`);
    }
    if (structured.approvals.length > 0) {
        segments.push(`Approvals ${structured.approvals.length}`);
    }
    if (structured.task) {
        segments.push('Task 1');
    }
    if (structured.patches.length > 0) {
        segments.push(`Patches ${structured.patches.length}`);
    }
    if (segments.length === 0) {
        return 'Update';
    }
    return `Structured update: ${segments.join(' | ')}`;
}

function toApprovalDecision(approved: boolean | undefined): AssistantUiStructuredApproval['decision'] {
    if (approved === undefined) {
        return 'pending';
    }
    return approved ? 'approved' : 'denied';
}

function summarizeUnknown(value: unknown, maxLength: number): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    const text = typeof value === 'string'
        ? value.trim()
        : (() => {
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        })();
    if (!text) {
        return undefined;
    }

    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function toRiskSeverity(risk: number): AssistantUiStructuredApproval['severity'] {
    if (risk >= 9) {
        return 'critical';
    }
    if (risk >= 7) {
        return 'high';
    }
    if (risk >= 4) {
        return 'medium';
    }
    return 'low';
}

function severityRank(value: AssistantUiStructuredApproval['severity']): number {
    switch (value) {
        case 'critical':
            return 4;
        case 'high':
            return 3;
        case 'medium':
            return 2;
        default:
            return 1;
    }
}

function buildStructuredPayload(
    round: TimelineTurnRound,
    runtimePendingLabel?: string,
): AssistantUiStructuredPayload | undefined {
    if (!round.assistantTurn) {
        return undefined;
    }

    const tools = (round.assistantTurn.toolCalls ?? []).map((toolCall) => ({
        toolName: normalizeText(toolCall.toolName) || 'Tool',
        status: toolCall.status,
        inputSummary: summarizeUnknown(toolCall.args, 120),
        resultSummary: summarizeUnknown(toolCall.result, 140),
    }));
    const approvals = (round.assistantTurn.effectRequests ?? [])
        .map((effect) => {
            const risk = Number.isFinite(effect.risk) ? effect.risk : 0;
            const severity = toRiskSeverity(risk);
            return {
                requestId: normalizeText(effect.id) || 'unknown-effect-request',
                effectType: normalizeText(effect.effectType) || 'effect',
                risk,
                severity,
                decision: toApprovalDecision(effect.approved),
                blocking: severity === 'high' || severity === 'critical',
            };
        })
        .sort((left, right) => (
            severityRank(right.severity) - severityRank(left.severity)
            || right.risk - left.risk
        ));
    const task = round.assistantTurn.taskCard
        ? {
            title: normalizeText(round.assistantTurn.taskCard.title) || 'Task center',
            status: round.assistantTurn.taskCard.status ?? 'idle',
            progress: Array.isArray(round.assistantTurn.taskCard.tasks) && round.assistantTurn.taskCard.tasks.length > 0
                ? {
                    completed: round.assistantTurn.taskCard.tasks.filter((entry) => (
                        entry.status === 'completed' || entry.status === 'complete' || entry.status === 'skipped'
                    )).length,
                    total: round.assistantTurn.taskCard.tasks.length,
                }
                : undefined,
        }
        : undefined;
    const patches = (round.assistantTurn.patches ?? []).map((patch) => ({
        filePath: normalizeText(patch.filePath) || 'Unknown file',
        status: patch.status,
    }));

    const pendingLabel = normalizeText(runtimePendingLabel);
    const runtime = pendingLabel
        ? {
            pendingLabel,
        }
        : undefined;

    if (tools.length === 0 && approvals.length === 0 && !task && patches.length === 0 && !runtime) {
        return undefined;
    }

    return {
        runtime,
        tools,
        approvals,
        task,
        patches,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asDecision(value: unknown): AssistantUiStructuredApproval['decision'] {
    if (value === 'approved' || value === 'denied' || value === 'pending') {
        return value;
    }
    return 'pending';
}

function asSeverity(value: unknown): AssistantUiStructuredApproval['severity'] {
    if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') {
        return value;
    }
    return 'low';
}

function asToolStatus(value: unknown): AssistantUiStructuredTool['status'] {
    if (value === 'running' || value === 'success' || value === 'failed') {
        return value;
    }
    return 'running';
}

function asTaskStatus(value: unknown): AssistantUiStructuredTask['status'] {
    if (value === 'idle' || value === 'running' || value === 'finished' || value === 'failed') {
        return value;
    }
    return 'idle';
}

function asPatchStatus(value: unknown): AssistantUiStructuredPatch['status'] {
    if (value === 'proposed' || value === 'applied' || value === 'rejected') {
        return value;
    }
    return 'proposed';
}

export function readAssistantUiStructuredPayload(customValue: unknown): AssistantUiStructuredPayload | null {
    if (!isRecord(customValue)) {
        return null;
    }

    const rawStructured = customValue.structured;
    if (!isRecord(rawStructured)) {
        return null;
    }

    const rawTools = Array.isArray(rawStructured.tools) ? rawStructured.tools : [];
    const tools: AssistantUiStructuredTool[] = rawTools
        .filter(isRecord)
        .map((tool) => ({
            toolName: normalizeText(asString(tool.toolName)) || 'Tool',
            status: asToolStatus(tool.status),
            inputSummary: normalizeText(asString(tool.inputSummary)) || undefined,
            resultSummary: normalizeText(asString(tool.resultSummary)) || undefined,
        }));

    const rawApprovals = Array.isArray(rawStructured.approvals) ? rawStructured.approvals : [];
    const approvals: AssistantUiStructuredApproval[] = rawApprovals
        .filter(isRecord)
        .map((approval) => ({
            requestId: normalizeText(asString(approval.requestId)) || 'unknown-effect-request',
            effectType: normalizeText(asString(approval.effectType)) || 'effect',
            risk: asNumber(approval.risk),
            severity: asSeverity(approval.severity),
            decision: asDecision(approval.decision),
            blocking: Boolean(approval.blocking),
        }));

    const runtime = isRecord(rawStructured.runtime)
        ? {
            pendingLabel: normalizeText(asString(rawStructured.runtime.pendingLabel)) || undefined,
        }
        : undefined;

    const task = isRecord(rawStructured.task)
        ? {
            title: normalizeText(asString(rawStructured.task.title)) || 'Task center',
            status: asTaskStatus(rawStructured.task.status),
            progress: isRecord(rawStructured.task.progress)
                ? {
                    completed: Math.max(0, Math.floor(asNumber(rawStructured.task.progress.completed))),
                    total: Math.max(0, Math.floor(asNumber(rawStructured.task.progress.total))),
                }
                : undefined,
        }
        : undefined;

    const rawPatches = Array.isArray(rawStructured.patches) ? rawStructured.patches : [];
    const patches: AssistantUiStructuredPatch[] = rawPatches
        .filter(isRecord)
        .map((patch) => ({
            filePath: normalizeText(asString(patch.filePath)) || 'Unknown file',
            status: asPatchStatus(patch.status),
        }));

    if (tools.length === 0 && approvals.length === 0 && !task && patches.length === 0 && !runtime?.pendingLabel) {
        return null;
    }

    return {
        runtime,
        tools,
        approvals,
        task,
        patches,
    };
}

export function buildAssistantUiExternalMessages(
    rounds: TimelineTurnRound[],
    options: AssistantUiProjectionOptions = {},
): AssistantUiExternalMessage[] {
    const messages: AssistantUiExternalMessage[] = [];
    const pendingLabel = normalizeText(options.pendingLabel);
    const lastRoundIndex = rounds.length - 1;

    for (let index = 0; index < rounds.length; index += 1) {
        const round = rounds[index];
        const userContent = normalizeText(round.userMessage?.content);
        if (round.userMessage && userContent) {
            messages.push({
                id: round.userMessage.id,
                role: 'user',
                text: userContent,
                timestamp: round.userMessage.timestamp,
                turnId: round.id,
                source: 'user_message',
            });
        }

        if (!round.assistantTurn) {
            continue;
        }

        const isLastRound = index === lastRoundIndex;
        const roundPendingLabel = isLastRound ? pendingLabel : '';
        const assistantText = buildAssistantTurnText(round);
        const structured = buildStructuredPayload(round, roundPendingLabel);
        if (!assistantText) {
            if (structured) {
                messages.push({
                    id: round.assistantTurn.id,
                    role: 'assistant',
                    text: roundPendingLabel || buildStructuredFallbackText(structured),
                    timestamp: round.assistantTurn.timestamp,
                    turnId: round.id,
                    source: 'assistant_turn',
                    cardCounts: {
                        tools: round.assistantTurn.toolCalls?.length ?? 0,
                        approvals: round.assistantTurn.effectRequests?.length ?? 0,
                        tasks: round.assistantTurn.taskCard ? 1 : 0,
                        patches: round.assistantTurn.patches?.length ?? 0,
                    },
                    structured,
                });
                continue;
            }
            if (isLastRound && pendingLabel) {
                messages.push({
                    id: round.assistantTurn.id,
                    role: 'assistant',
                    text: pendingLabel,
                    timestamp: round.assistantTurn.timestamp,
                    turnId: round.id,
                    source: 'assistant_turn',
                    cardCounts: {
                        tools: 0,
                        approvals: 0,
                        tasks: 0,
                        patches: 0,
                    },
                    structured,
                });
            }
            continue;
        }

        messages.push({
            id: round.assistantTurn.id,
            role: 'assistant',
            text: assistantText,
            timestamp: round.assistantTurn.timestamp,
            turnId: round.id,
            source: 'assistant_turn',
            cardCounts: {
                tools: round.assistantTurn.toolCalls?.length ?? 0,
                approvals: round.assistantTurn.effectRequests?.length ?? 0,
                tasks: round.assistantTurn.taskCard ? 1 : 0,
                patches: round.assistantTurn.patches?.length ?? 0,
            },
            structured,
        });
    }

    return messages;
}

export function toAssistantUiThreadMessageLike(message: AssistantUiExternalMessage): ThreadMessageLike {
    return {
        id: message.id,
        role: message.role,
        createdAt: new Date(message.timestamp),
        content: [{ type: 'text', text: message.text }],
        metadata: {
            custom: {
                source: message.source,
                turnId: message.turnId,
                cardCounts: message.cardCounts,
                structured: message.structured,
            },
        },
    };
}

import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import { buildTimelineTurnRoundViewModel } from '../src/components/Chat/Timeline/viewModels/turnRounds';
import type { AssistantTurnItem, TaskCardItem, TaskEvent, TaskSession, TimelineItemType } from '../src/types';

type RealUiTimelineReplayCase = {
    id: string;
    sourceThreadId: string;
    failureClass: string;
    focus: string[];
    dbStats: {
        messageCount: number;
        userMessageCount: number;
        assistantMessageCount: number;
        firstAt: string;
        lastAt: string;
        durationMs: number;
        maxObservedGapMs: number;
    };
    session: {
        taskId: string;
        title: string;
        status: TaskSession['status'];
        taskMode: TaskSession['taskMode'];
    };
    events: TaskEvent[];
    expectations: {
        minRounds: number;
        expectedEventTypesInclude: TaskEvent['type'][];
        expectedVisibleTextIncludes: string[];
        expectedTaskTitlesInclude: string[];
        expectedSectionLabelsInclude: string[];
        expectedFinalTaskStatus?: TaskCardItem['status'];
        expectedAllTaskItemsCompleted?: boolean;
        expectedCollaborationCleared?: boolean;
        forbiddenVisibleTextIncludes: string[];
    };
};

type RealUiTimelineReplayFixture = {
    source: string;
    capturedAt: string;
    cases: RealUiTimelineReplayCase[];
};

function loadFixture(): RealUiTimelineReplayFixture {
    const currentFilePath = fileURLToPath(import.meta.url);
    const fixturePath = path.resolve(
        path.dirname(currentFilePath),
        '../../sidecar/tests/fixtures/real-ui-timeline-replay-cases.json',
    );
    return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as RealUiTimelineReplayFixture;
}

function makeSession(replayCase: RealUiTimelineReplayCase): TaskSession {
    const firstTimestamp = replayCase.events[0]?.timestamp ?? replayCase.dbStats.firstAt;
    const lastTimestamp = replayCase.events[replayCase.events.length - 1]?.timestamp ?? replayCase.dbStats.lastAt;
    return {
        taskId: replayCase.session.taskId,
        title: replayCase.session.title,
        status: replayCase.session.status,
        taskMode: replayCase.session.taskMode,
        planSteps: [],
        toolCalls: [],
        effects: [],
        patches: [],
        messages: [],
        events: replayCase.events,
        createdAt: firstTimestamp,
        updatedAt: lastTimestamp,
    };
}

function extractAssistantTurns(items: TimelineItemType[]): AssistantTurnItem[] {
    return items.filter((item): item is AssistantTurnItem => item.type === 'assistant_turn');
}

function extractTaskCards(items: TimelineItemType[]): TaskCardItem[] {
    return extractAssistantTurns(items)
        .map((turn) => turn.taskCard)
        .filter((card): card is TaskCardItem => Boolean(card));
}

function renderSearchText(items: TimelineItemType[]): string {
    return JSON.stringify(items);
}

describe('real DB UI timeline replay acceptance', () => {
    const fixture = loadFixture();

    test('fixture covers long, slow, and manual-review DB timeline samples', () => {
        expect(fixture.source).toContain('.coworkany/data/coworkany.db');
        expect(fixture.cases).toHaveLength(3);
        expect(fixture.cases.map((entry) => entry.sourceThreadId)).toEqual(expect.arrayContaining([
            'thread-doc-004',
            'thread-comm-004-debug-no-approval',
            'thread-web-004-debug-no-approval',
        ]));
        expect(fixture.cases.some((entry) => entry.focus.includes('long_multiturn') && entry.dbStats.messageCount >= 40)).toBe(true);
        expect(fixture.cases.some((entry) => entry.focus.includes('slow_response') && entry.dbStats.maxObservedGapMs >= 60_000)).toBe(true);
        expect(fixture.cases.some((entry) => entry.focus.includes('manual_review'))).toBe(true);
    });

    for (const replayCase of fixture.cases) {
        test(`renders DB-derived UI timeline replay: ${replayCase.id}`, () => {
            const session = makeSession(replayCase);
            const result = buildTimelineItems(session);
            const rounds = buildTimelineTurnRoundViewModel(result.items).rounds;
            const taskCards = extractTaskCards(result.items);
            const taskCard = taskCards[taskCards.length - 1];
            const renderedText = renderSearchText(result.items);
            const eventTypes = replayCase.events.map((event) => event.type);

            expect(result.hiddenEventCount).toBe(0);
            expect(rounds.length).toBeGreaterThanOrEqual(replayCase.expectations.minRounds);
            expect(taskCard).toBeDefined();
            for (const eventType of replayCase.expectations.expectedEventTypesInclude) {
                expect(eventTypes).toContain(eventType);
            }
            for (const text of replayCase.expectations.expectedVisibleTextIncludes) {
                expect(renderedText).toContain(text);
            }
            for (const text of replayCase.expectations.forbiddenVisibleTextIncludes) {
                expect(renderedText).not.toContain(text);
            }
            for (const title of replayCase.expectations.expectedTaskTitlesInclude) {
                expect(taskCard.tasks?.some((task) => task.title === title)).toBe(true);
            }
            for (const label of replayCase.expectations.expectedSectionLabelsInclude) {
                expect(taskCard.sections.some((section) => section.label === label)).toBe(true);
            }
            if (replayCase.expectations.expectedFinalTaskStatus) {
                expect(taskCard.status).toBe(replayCase.expectations.expectedFinalTaskStatus);
            }
            if (replayCase.expectations.expectedAllTaskItemsCompleted) {
                expect(taskCard.tasks?.every((task) => (
                    task.status === 'completed'
                    || task.status === 'complete'
                    || task.status === 'skipped'
                    || task.status === 'failed'
                ))).toBe(true);
            }
            if (replayCase.expectations.expectedCollaborationCleared) {
                expect(taskCard.collaboration).toBeUndefined();
            }
        });
    }
});

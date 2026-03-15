import { describe, expect, test } from 'bun:test';
import { normalizeRecoverableTaskInputs } from '../src/agent/recoveryHints';

describe('normalizeRecoverableTaskInputs', () => {
    test('filters scheduled task ids without dropping valid recoverable tasks', () => {
        const validTaskId = '330f06be-1f4e-4e3a-976c-89cb29c9a9d4';
        const result = normalizeRecoverableTaskInputs(
            [validTaskId, 'scheduled_7c78e583-accb-46dd-a4e5-1532f14d5d4d'],
            [
                { taskId: validTaskId, workspacePath: 'D:\\workspace\\valid' },
                {
                    taskId: 'scheduled_7c78e583-accb-46dd-a4e5-1532f14d5d4d',
                    workspacePath: 'D:\\workspace\\scheduled',
                },
            ],
        );

        expect(result.taskIds).toEqual([validTaskId]);
        expect(result.taskHints).toEqual([{ taskId: validTaskId, workspacePath: 'D:\\workspace\\valid' }]);
        expect(result.invalidTaskIds).toEqual(['scheduled_7c78e583-accb-46dd-a4e5-1532f14d5d4d']);
    });
});

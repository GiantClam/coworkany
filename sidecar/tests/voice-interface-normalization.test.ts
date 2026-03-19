import { describe, expect, test } from 'bun:test';
import { normalizeMacOSTextForSpeech } from '../src/agent/jarvis/voiceInterface';

describe('normalizeMacOSTextForSpeech', () => {
    test('removes apostrophes inside English contractions for mixed-language speech', () => {
        const normalized = normalizeMacOSTextForSpeech(
            "定时任务已完成。If You're building, You’re testing, it's ready."
        );

        expect(normalized).toContain('If Youre building');
        expect(normalized).toContain('Youre testing');
        expect(normalized).toContain('its ready');
        expect(normalized).not.toContain("You're");
        expect(normalized).not.toContain('You’re');
        expect(normalized).not.toContain("it's");
    });
});

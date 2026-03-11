import { describe, expect, test } from 'bun:test';
import {
    getBrowserFeedDirective,
    isXFollowingResearchRequest,
    shouldSuppressTriggeredSkillForBrowserFeed,
} from '../src/agent/browserFeedIntent';

describe('browser feed intent', () => {
    test('detects X following research requests', () => {
        expect(
            isXFollowingResearchRequest('查看我最新的X上关注人员的帖文，是否有AI相关的有价值的信息')
        ).toBe(true);
        expect(
            isXFollowingResearchRequest('帮我分析一下英伟达股票走势')
        ).toBe(false);
    });

    test('suppresses stock skill for X following feed queries', () => {
        const message = '查看我最新的X上关注人员的帖文，是否有AI相关的有价值的信息';
        expect(shouldSuppressTriggeredSkillForBrowserFeed('stock-research', message)).toBe(true);
        expect(shouldSuppressTriggeredSkillForBrowserFeed('research-topic', message)).toBe(true);
        expect(shouldSuppressTriggeredSkillForBrowserFeed('frontend-design', message)).toBe(false);
    });

    test('adds explicit workflow directive for X feed tasks', () => {
        const directive = getBrowserFeedDirective('查看我最新的X上关注人员的帖文，是否有AI相关的有价值的信息');
        expect(directive).toContain('Following');
        expect(directive).toContain('browser_screenshot');
        expect(directive).toContain('suspend');
    });
});

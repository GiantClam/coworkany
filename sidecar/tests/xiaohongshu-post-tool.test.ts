import { describe, expect, test } from 'bun:test';
import { __internal } from '../src/tools/xiaohongshuPost';

describe('xiaohongshu_post helpers', () => {
    test('recognizes login redirect urls as auth-blocked publish surfaces', () => {
        expect(__internal.isLoginRedirectUrl(
            'https://creator.xiaohongshu.com/login?source=&redirectReason=401&lastUrl=%252Fpublish%252Fpublish'
        )).toBe(true);
        expect(__internal.isLoginRedirectUrl(
            'https://creator.xiaohongshu.com/publish/publish'
        )).toBe(false);
    });

    test('treats login-redirect surface as not ready even when some page shell exists', () => {
        const state = __internal.parsePublishSurfaceState(JSON.stringify({
            url: 'https://creator.xiaohongshu.com/login?source=&redirectReason=401&lastUrl=%252Fpublish%252Fpublish',
            title: '小红书创作服务平台',
            hasLoginPrompt: true,
            isLoginRedirect: true,
            hasDashboardShell: true,
            hasUploadTab: false,
            hasFileInput: false,
            hasTitleField: false,
            hasContentField: false,
            hasPublishButton: true,
            visibleActionTexts: ['发布'],
        }));

        expect(__internal.isPublishSurfaceReady(state)).toBe(false);
    });

    test('treats editor-ready publish surface as ready', () => {
        const state = __internal.parsePublishSurfaceState(JSON.stringify({
            url: 'https://creator.xiaohongshu.com/publish/publish',
            title: '发布笔记',
            hasLoginPrompt: false,
            isLoginRedirect: false,
            hasDashboardShell: true,
            hasUploadTab: true,
            hasFileInput: true,
            hasTitleField: true,
            hasContentField: true,
            hasPublishButton: true,
            visibleActionTexts: ['上传图文', '发布'],
        }));

        expect(__internal.isPublishSurfaceReady(state)).toBe(true);
    });
});

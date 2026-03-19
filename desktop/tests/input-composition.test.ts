import { describe, expect, test } from 'bun:test';
import {
    isImeConfirmingEnter,
    shouldSubmitOnEnter,
} from '../src/components/Chat/components/inputComposition';

describe('isImeConfirmingEnter', () => {
    test('returns false for non-Enter keys', () => {
        expect(isImeConfirmingEnter({ key: 'a' }, false)).toBe(false);
    });

    test('returns false for normal Enter when not composing', () => {
        expect(
            isImeConfirmingEnter(
                { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 } },
                false
            )
        ).toBe(false);
    });

    test('returns true when composition state ref is active', () => {
        expect(
            isImeConfirmingEnter(
                { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 } },
                true
            )
        ).toBe(true);
    });

    test('returns true when native event is composing', () => {
        expect(
            isImeConfirmingEnter(
                { key: 'Enter', nativeEvent: { isComposing: true, keyCode: 13 } },
                false
            )
        ).toBe(true);
    });

    test('returns true for IME fallback keyCode 229', () => {
        expect(
            isImeConfirmingEnter(
                { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 229 } },
                false
            )
        ).toBe(true);
    });
});

describe('shouldSubmitOnEnter', () => {
    test('returns true for plain Enter when not composing', () => {
        expect(
            shouldSubmitOnEnter(
                { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false, keyCode: 13 } },
                false
            )
        ).toBe(true);
    });

    test('returns false for Shift+Enter', () => {
        expect(
            shouldSubmitOnEnter(
                { key: 'Enter', shiftKey: true, nativeEvent: { isComposing: false, keyCode: 13 } },
                false
            )
        ).toBe(false);
    });

    test('returns false while IME is composing', () => {
        expect(
            shouldSubmitOnEnter(
                { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true, keyCode: 13 } },
                false
            )
        ).toBe(false);
    });
});

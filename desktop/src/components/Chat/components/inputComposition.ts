export interface EnterKeyEventLike {
    key: string;
    shiftKey?: boolean;
    nativeEvent?: {
        isComposing?: boolean;
        keyCode?: number;
    };
}

export function isImeConfirmingEnter(
    event: EnterKeyEventLike,
    composingState: boolean
): boolean {
    if (event.key !== 'Enter') {
        return false;
    }

    return (
        composingState ||
        event.nativeEvent?.isComposing === true ||
        event.nativeEvent?.keyCode === 229
    );
}

export function shouldSubmitOnEnter(
    event: EnterKeyEventLike,
    composingState: boolean
): boolean {
    return event.key === 'Enter' && !event.shiftKey && !isImeConfirmingEnter(event, composingState);
}

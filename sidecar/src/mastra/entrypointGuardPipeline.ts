export type GuardPass = {
    ok: true;
};

export type GuardFail<TPayload = undefined> = {
    ok: false;
    error: string;
    payload: TPayload;
};

export type GuardResult<TPayload = undefined> = GuardPass | GuardFail<TPayload>;

type GuardFn<TPayload> = () => GuardResult<TPayload> | Promise<GuardResult<TPayload>>;

export function passGuard(): GuardPass {
    return { ok: true };
}

export function failGuard<TPayload>(error: string, payload: TPayload): GuardFail<TPayload> {
    return {
        ok: false,
        error,
        payload,
    };
}

export async function runGuardPipeline<TPayload>(
    guards: Array<GuardFn<TPayload>>,
): Promise<GuardResult<TPayload>> {
    for (const guard of guards) {
        const result = await guard();
        if (!result.ok) {
            return result;
        }
    }
    return passGuard();
}

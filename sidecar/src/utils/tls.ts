const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

let insecureTlsWarningPrinted = false;
let nodeGlobalTlsWarningPrinted = false;

function isBunRuntime(): boolean {
    return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

function isTruthy(value: string | undefined): boolean {
    if (!value) return false;
    return TRUTHY_VALUES.has(value.trim().toLowerCase());
}

export function isInsecureTlsEnabled(explicitAllow?: boolean): boolean {
    return explicitAllow === true || isTruthy(process.env.COWORKANY_ALLOW_INSECURE_TLS);
}

function logInsecureTlsWarning(message: string): void {
    if (insecureTlsWarningPrinted) return;
    insecureTlsWarningPrinted = true;
    console.warn(message);
}

export function applyInsecureTlsToRequestInit(
    init: RequestInit = {},
    explicitAllow?: boolean
): RequestInit {
    if (!isInsecureTlsEnabled(explicitAllow)) {
        return init;
    }

    if (isBunRuntime()) {
        logInsecureTlsWarning(
            '[TLS] Insecure TLS enabled for request. Certificate verification is disabled (Bun fetch tls.rejectUnauthorized=false).'
        );
        return {
            ...(init as Record<string, unknown>),
            tls: {
                rejectUnauthorized: false,
            },
        } as RequestInit;
    }

    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        if (!nodeGlobalTlsWarningPrinted) {
            nodeGlobalTlsWarningPrinted = true;
            logInsecureTlsWarning(
                '[TLS] Insecure TLS enabled via NODE_TLS_REJECT_UNAUTHORIZED=0 for current process. Use only in trusted environments.'
            );
        }
    }

    return init;
}

export function createTlsAwareFetch(
    explicitAllow?: boolean
): typeof fetch | undefined {
    if (!isInsecureTlsEnabled(explicitAllow)) {
        return undefined;
    }

    return ((input: unknown, init?: RequestInit) => {
        const nextInit = applyInsecureTlsToRequestInit(init ?? {}, explicitAllow);
        return fetch(input as any, nextInit);
    }) as typeof fetch;
}

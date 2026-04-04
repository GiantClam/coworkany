export type ForcedRouteMode = 'chat' | 'task';

export type RoutedInputParseResult = {
    cleanText: string;
    forcedRouteMode: ForcedRouteMode | null;
    usedEnvelope: boolean;
};

const ROUTE_TOKEN_ONLY_PATTERN = /^\s*__route_(chat|task)__\s*$/iu;
const ROUTE_TOKEN_PREFIX_PATTERN = /^\s*__route_(chat|task)__\s*(?:\n+|[\t ]+)([\s\S]*)$/iu;
const LEGACY_ROUTE_ENVELOPE_PATTERN =
    /^\s*(?:原始任务|original\s+task)\s*[:：]\s*([\s\S]*?)(?:\n+(?:用户路由|user\s+route)\s*[:：]\s*([^\n]+))?\s*$/iu;

function toForcedRouteMode(value: string | null | undefined): ForcedRouteMode | null {
    if (!value) {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'chat') {
        return 'chat';
    }
    if (
        normalized === 'task'
        || normalized === 'immediate_task'
        || normalized === 'scheduled_task'
        || normalized === 'scheduled_multi_task'
    ) {
        return 'task';
    }
    return null;
}

export function parseRoutedInput(input: string): RoutedInputParseResult {
    const raw = input ?? '';
    const tokenOnlyMatch = raw.match(ROUTE_TOKEN_ONLY_PATTERN);
    if (tokenOnlyMatch?.[1]) {
        return {
            cleanText: '',
            forcedRouteMode: toForcedRouteMode(tokenOnlyMatch[1]),
            usedEnvelope: true,
        };
    }

    const tokenPrefixMatch = raw.match(ROUTE_TOKEN_PREFIX_PATTERN);
    if (tokenPrefixMatch?.[1]) {
        return {
            cleanText: tokenPrefixMatch[2]?.trim() ?? '',
            forcedRouteMode: toForcedRouteMode(tokenPrefixMatch[1]),
            usedEnvelope: true,
        };
    }

    const legacyEnvelopeMatch = raw.match(LEGACY_ROUTE_ENVELOPE_PATTERN);
    if (legacyEnvelopeMatch?.[1]) {
        return {
            cleanText: legacyEnvelopeMatch[1].trim(),
            forcedRouteMode: toForcedRouteMode(legacyEnvelopeMatch[2]),
            usedEnvelope: true,
        };
    }

    return {
        cleanText: raw,
        forcedRouteMode: null,
        usedEnvelope: false,
    };
}

export function resolveForcedWorkMode(
    forcedRouteMode: ForcedRouteMode | null | undefined,
): 'chat' | 'immediate_task' | undefined {
    if (forcedRouteMode === 'chat') {
        return 'chat';
    }
    if (forcedRouteMode === 'task') {
        return 'immediate_task';
    }
    return undefined;
}

export type SkillImportPlan = {
    kind: 'command' | 'download';
    label: string;
    binary: string;
    runner?: 'brew' | 'npm' | 'uv' | 'pip' | 'go' | 'winget' | 'choco';
    command?: string;
    url?: string;
    extract?: boolean;
};

export type SkillImportDependencyCheck = {
    platformEligible: boolean;
    satisfied: boolean;
    missing: string[];
    canAutoInstall: boolean;
    installPlans: SkillImportPlan[];
    installCommands: string[];
};

export type SkillImportAttempt = {
    kind: 'command' | 'download';
    label: string;
    success: boolean;
    skipped?: boolean;
    error?: string;
    output?: string;
    binary?: string;
    command?: string;
    url?: string;
    targetPath?: string;
};

export type SkillImportFeedback = {
    success: boolean;
    skillId?: string;
    error?: string;
    warnings: string[];
    dependencyCheck?: SkillImportDependencyCheck;
    installResults: SkillImportAttempt[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String) : [];
}

function parseDependencyCheck(value: unknown): SkillImportDependencyCheck | undefined {
    const record = asRecord(value);
    if (!record) return undefined;

    const installPlans = Array.isArray(record.installPlans)
        ? record.installPlans
            .map((entry) => asRecord(entry))
            .filter((entry): entry is Record<string, unknown> => Boolean(entry))
            .map((entry) => ({
                kind: (entry.kind === 'download' ? 'download' : 'command') as SkillImportPlan['kind'],
                label: String(entry.label ?? ''),
                binary: String(entry.binary ?? ''),
                runner: typeof entry.runner === 'string' ? entry.runner as SkillImportPlan['runner'] : undefined,
                command: typeof entry.command === 'string' ? entry.command : undefined,
                url: typeof entry.url === 'string' ? entry.url : undefined,
                extract: typeof entry.extract === 'boolean' ? entry.extract : undefined,
            }))
            .filter((entry) => entry.label && entry.binary)
        : [];

    return {
        platformEligible: Boolean(record.platformEligible),
        satisfied: Boolean(record.satisfied),
        missing: asStringArray(record.missing),
        canAutoInstall: Boolean(record.canAutoInstall),
        installPlans,
        installCommands: asStringArray(record.installCommands),
    };
}

function parseInstallResults(value: unknown): SkillImportAttempt[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => ({
            kind: (entry.kind === 'download' ? 'download' : 'command') as SkillImportAttempt['kind'],
            label: String(entry.label ?? ''),
            success: Boolean(entry.success),
            skipped: typeof entry.skipped === 'boolean' ? entry.skipped : undefined,
            error: typeof entry.error === 'string' ? entry.error : undefined,
            output: typeof entry.output === 'string' ? entry.output : undefined,
            binary: typeof entry.binary === 'string' ? entry.binary : undefined,
            command: typeof entry.command === 'string' ? entry.command : undefined,
            url: typeof entry.url === 'string' ? entry.url : undefined,
            targetPath: typeof entry.targetPath === 'string' ? entry.targetPath : undefined,
        }))
        .filter((entry) => entry.label.length > 0);
}

function parseImportFeedback(value: unknown): SkillImportFeedback | null {
    const record = asRecord(value);
    if (!record) return null;
    const dependencyCheck = parseDependencyCheck(record.dependencyCheck);
    const installResults = parseInstallResults(record.installResults);
    const warnings = asStringArray(record.warnings);
    const skillId = typeof record.skillId === 'string' ? record.skillId : undefined;
    const error = typeof record.error === 'string' ? record.error : undefined;

    if (
        typeof record.success !== 'boolean' &&
        !dependencyCheck &&
        installResults.length === 0 &&
        warnings.length === 0 &&
        !skillId &&
        !error
    ) {
        return null;
    }

    return {
        success: Boolean(record.success),
        skillId,
        error,
        warnings,
        dependencyCheck,
        installResults,
    };
}

export function extractSkillImportFeedback(value: unknown): SkillImportFeedback | null {
    const direct = parseImportFeedback(value);
    if (direct) return direct;

    const record = asRecord(value);
    if (!record) return null;

    const nestedPayload = parseImportFeedback(record.payload);
    if (nestedPayload) return nestedPayload;

    const importResult = parseImportFeedback(record.importResult);
    if (importResult) return importResult;

    const sidecar = asRecord(record.sidecar);
    if (sidecar) {
        const sidecarPayload = parseImportFeedback(sidecar.payload);
        if (sidecarPayload) return sidecarPayload;
    }

    return null;
}

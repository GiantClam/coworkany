export type SupervisorIterationDecision = {
    continue: boolean;
    feedback: string;
};

export type SupervisorIterationInput = {
    iteration: number;
    toolCalls: unknown[];
    text: string;
    isFinal?: boolean;
};

const FAILURE_REPAIR_SIGNAL_PATTERN = /(?:失败|报错|错误|参数写错|没有生成成功|未生成成功|exit\s*code|failed|failure|error|stderr|unrecognized\s+option|option\s+not\s+found)/iu;
const CONTINUATION_ACTION_PATTERN = /(?:继续|重试|重新执行|修正|修复|执行正确|correct|retry|rerun|continue|execute)/iu;
const LOCAL_COMMAND_ACTION_PATTERN = /(?:执行|运行|run|execute|重试|重新执行|修正|继续)/iu;
const USER_CONFIRMATION_CONTINUE_PATTERN = /(?:请确认|请允许|回复[^\n]{0,20}(?:继续|执行修复版|执行)|如果[^\n]{0,40}(?:继续|同意|允许|愿意|要我)|我可以[^\n]{0,40}继续|我马上[^\n]{0,40}重试|需要[^\n]{0,20}确认|confirm[^\n]{0,40}continue|reply[^\n]{0,40}continue|should\s+i\s+proceed|if\s+you[^\n]{0,40}want[^\n]{0,40}continue|i\s+can[^\n]{0,40}(?:retry|continue|execute))/iu;
const USER_MANUAL_COMMAND_DELEGATION_PATTERN = /(?:请|你可以|可在|现在请|直接用|运行以下|执行以下|执行下面|复制(?:并)?执行|copy(?:\s+and)?\s+run)[^\n]{0,80}(?:终端|命令|command|terminal|bash|shell|```bash|```sh|执行)|(?:在|到)[^\n]{0,20}(?:终端|terminal|shell)[^\n]{0,40}(?:执行|运行|run)|(?:run|execute)[^\n]{0,60}(?:yourself|in\s+(?:a\s+)?terminal)/iu;
const NECESSARY_HUMAN_ASSISTANCE_PATTERN = /(?:sudo|密码|password|登录|登陆|验证码|captcha|2fa|mfa|授权|authorize|approval|approve|批准|系统偏好设置|隐私与安全性|manual\s+review|人工审核|手动登录)/iu;
const FFMPEG_GLUE_OPTION_PATTERN = /-(framerate|r)(\d+(?:\/\d+)?)/iu;

function buildKnownCommandRepairInstruction(text: string): string | undefined {
    const ffmpegGlueOption = FFMPEG_GLUE_OPTION_PATTERN.exec(text);
    if (ffmpegGlueOption) {
        const optionName = ffmpegGlueOption[1];
        const optionValue = ffmpegGlueOption[2];
        return `Known command repair: do not repeat "-${optionName}${optionValue}"; run the corrected ffmpeg option as "-${optionName} ${optionValue}" and verify the output file.`;
    }
    return undefined;
}

export function asksForContinuationAfterToolFailure(text: string): boolean {
    const normalized = text.trim();
    if (normalized.length === 0) {
        return false;
    }
    return FAILURE_REPAIR_SIGNAL_PATTERN.test(normalized)
        && CONTINUATION_ACTION_PATTERN.test(normalized)
        && USER_CONFIRMATION_CONTINUE_PATTERN.test(normalized);
}

export function delegatesManualCommandAfterToolFailure(text: string): boolean {
    const normalized = text.trim();
    if (normalized.length === 0) {
        return false;
    }
    return FAILURE_REPAIR_SIGNAL_PATTERN.test(normalized)
        && CONTINUATION_ACTION_PATTERN.test(normalized)
        && USER_MANUAL_COMMAND_DELEGATION_PATTERN.test(normalized)
        && !NECESSARY_HUMAN_ASSISTANCE_PATTERN.test(normalized);
}

export function delegatesAutomatableManualCommand(text: string): boolean {
    const normalized = text.trim();
    if (normalized.length === 0) {
        return false;
    }
    return USER_MANUAL_COMMAND_DELEGATION_PATTERN.test(normalized)
        && LOCAL_COMMAND_ACTION_PATTERN.test(normalized)
        && !NECESSARY_HUMAN_ASSISTANCE_PATTERN.test(normalized);
}

export function resolveSupervisorIterationDecision(input: SupervisorIterationInput): SupervisorIterationDecision | undefined {
    if (input.isFinal) {
        return undefined;
    }
    const text = input.text.trim();
    const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
    if (toolCalls.length === 0 && text.length >= 12) {
        if (asksForContinuationAfterToolFailure(text)) {
            const repairInstruction = buildKnownCommandRepairInstruction(text);
            return {
                continue: true,
                feedback: [
                    'Previous iteration reported a failed command/tool step and asked the user to confirm continuation.',
                    'Do not stop or ask for confirmation. Import the failure details from the previous text, run the corrected retry command now, verify the output artifact, then report final status.',
                    repairInstruction,
                ].filter((line): line is string => typeof line === 'string' && line.length > 0).join(' '),
            };
        }
        if (delegatesManualCommandAfterToolFailure(text)) {
            const repairInstruction = buildKnownCommandRepairInstruction(text);
            return {
                continue: true,
                feedback: [
                    'Previous iteration reported a failed command/tool step and delegated an automatable local command to the user.',
                    'Do not ask the user to run commands manually unless login, password, captcha, authorization, or other real human assistance is required.',
                    'Import the failure details, execute the corrected command yourself via tools, verify the output artifact, then report final status in user-readable language.',
                    repairInstruction,
                ].join(' '),
            };
        }
        if (delegatesAutomatableManualCommand(text)) {
            const repairInstruction = buildKnownCommandRepairInstruction(text);
            return {
                continue: true,
                feedback: [
                    'Previous iteration delegated an automatable local command to the user instead of executing it.',
                    'Unless the task requires login, password, captcha, authorization, or other real human assistance, CoworkAny must run local commands via tools.',
                    'Execute the command yourself, verify the actual result, then report a concise user-readable status.',
                    repairInstruction,
                ].filter((line): line is string => typeof line === 'string' && line.length > 0).join(' '),
            };
        }
        return {
            continue: false,
            feedback: 'Answer is already complete with no pending tool calls. Stop iteration.',
        };
    }
    if (input.iteration >= 10 && toolCalls.length === 0 && text.length < 20) {
        return {
            continue: false,
            feedback: 'No meaningful progress detected. Stop and provide current findings plus blockers.',
        };
    }
    return undefined;
}

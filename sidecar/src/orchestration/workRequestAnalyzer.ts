import { randomUUID } from 'crypto';
import {
    type ExecutionPlan,
    type ClarificationDecision,
    type FrozenWorkRequest,
    type NormalizedWorkRequest,
    type PresentationPayload,
    type PresentationContract,
    type TaskDefinition,
} from './workRequestSchema';
import { detectScheduledIntent } from '../scheduling/scheduledTasks';
import { cleanScheduledTaskResultText, normalizeScheduledTaskResultText } from '../scheduling/scheduledTaskPresentation';

function detectLanguage(text: string): string {
    return /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en';
}

function languageAwareQuestions(language: string): string[] {
    return language.startsWith('zh')
        ? ['请明确你要我继续处理的具体对象、文件、页面或任务目标。']
        : ['Please specify the exact object, file, page, or task you want me to continue with.'];
}

function isComplexPlanningTask(text: string, mode: NormalizedWorkRequest['mode']): boolean {
    if (mode === 'scheduled_task' || mode === 'scheduled_multi_task') {
        return true;
    }

    if (text.length > 120) {
        return true;
    }

    return /(计划|规划|拆分|分解|设计|方案|架构|实现|多步|multi-step|plan|break down|decompose|workflow|research)/i.test(text);
}

function inferPreferredSkills(text: string, mode: NormalizedWorkRequest['mode']): string[] {
    const skills = ['task-orchestrator'];
    if (isComplexPlanningTask(text, mode)) {
        skills.push('superpowers-workflow', 'planning-with-files');
    }
    return skills;
}

function isLikelyChat(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    if (!trimmed) return true;
    return /^(hi|hello|hey|你好|您好|在吗|thanks|thank you|谢谢|收到|ok|好的)[.!?？。!]*$/i.test(trimmed);
}

function buildClarificationDecision(input: {
    sourceText: string;
    executableText: string;
    mode: NormalizedWorkRequest['mode'];
}): ClarificationDecision {
    if (input.mode !== 'immediate_task') {
        return {
            required: false,
            questions: [],
            missingFields: [],
            canDefault: true,
            assumptions: [],
        };
    }

    const trimmed = input.executableText.trim();
    const language = detectLanguage(input.sourceText);
    const ambiguousReference =
        /(?:^|\b)(继续|接着|按刚才|照上面|这个|那个|这些|上面的|刚才的|that|those|it|them|continue|resume|same as above)\b/i.test(trimmed);
    const tooShortToAct = trimmed.length > 0 && trimmed.length < 8;

    if (ambiguousReference || tooShortToAct) {
        return {
            required: true,
            reason: language.startsWith('zh')
                ? '当前请求缺少明确执行对象。'
                : 'The current request is missing a concrete execution target.',
            questions: languageAwareQuestions(language),
            missingFields: ['task_scope'],
            canDefault: false,
            assumptions: [],
        };
    }

    return {
        required: false,
        questions: [],
        missingFields: [],
        canDefault: true,
        assumptions: [],
    };
}

function splitSegments(text: string): string[] {
    return text
        .split(/[\n。！？!?]+/)
        .map((segment) => segment.trim())
        .filter(Boolean);
}

function buildTaskDefinition(text: string, mode: NormalizedWorkRequest['mode']): TaskDefinition {
    const segments = splitSegments(text);
    const objective = (segments[0] || text).trim();
    const constraints = segments.slice(1);
    const acceptanceCriteria = segments.filter((segment) =>
        /(只保留|必须|不要|输出|格式|每篇|唯一标识|summary|summarize|reply only|只回复)/i.test(segment)
    );

    return {
        id: randomUUID(),
        title: objective.slice(0, 60) || 'Task',
        objective,
        constraints,
        acceptanceCriteria,
        dependencies: [],
        preferredSkills: inferPreferredSkills(text, mode),
        preferredTools: [],
    };
}

function buildPresentationContract(text: string, ttsEnabled: boolean): PresentationContract {
    return {
        uiFormat: 'chat_message',
        ttsEnabled,
        ttsMode: 'full',
        ttsMaxChars: 0,
        language: detectLanguage(text),
    };
}

export function analyzeWorkRequest(input: {
    sourceText: string;
    workspacePath: string;
    now?: Date;
}): NormalizedWorkRequest {
    const sourceText = input.sourceText.trim();
    const scheduledIntent = detectScheduledIntent(sourceText, input.now);
    const executableText = scheduledIntent?.taskQuery || sourceText;
    const mode = scheduledIntent
        ? 'scheduled_task'
        : isLikelyChat(executableText)
            ? 'chat'
            : 'immediate_task';
    const clarification = buildClarificationDecision({
        sourceText,
        executableText,
        mode,
    });

    return {
        schemaVersion: 1,
        mode,
        sourceText,
        workspacePath: input.workspacePath,
        schedule: scheduledIntent
            ? {
                executeAt: scheduledIntent.executeAt.toISOString(),
                timezone: 'Asia/Shanghai',
                recurrence: null,
            }
            : undefined,
        tasks: [buildTaskDefinition(executableText, mode)],
        clarification: {
            ...clarification,
            assumptions: [
                ...clarification.assumptions,
                ...(scheduledIntent ? ['Scheduled requests are frozen before background execution.'] : []),
            ],
        },
        presentation: buildPresentationContract(executableText, scheduledIntent?.speakResult ?? false),
        createdAt: new Date().toISOString(),
    };
}

export function freezeWorkRequest(request: NormalizedWorkRequest): FrozenWorkRequest {
    return {
        ...request,
        id: randomUUID(),
        frozenAt: new Date().toISOString(),
    };
}

export function buildExecutionPlan(request: FrozenWorkRequest): ExecutionPlan {
    const steps: ExecutionPlan['steps'] = [];
    const analysisStepId = randomUUID();
    const clarificationStepId = randomUUID();

    steps.push({
        stepId: analysisStepId,
        kind: 'analysis',
        title: 'Analyze user request',
        description: 'Normalize the raw user input into a structured work request.',
        status: 'completed',
        dependencies: [],
    });
    steps.push({
        stepId: clarificationStepId,
        kind: 'clarification',
        title: request.clarification.required ? 'Clarify missing inputs' : 'Freeze structured request',
        description: request.clarification.required
            ? request.clarification.questions.join(' ')
            : 'The request has been frozen and is ready for execution.',
        status: request.clarification.required ? 'blocked' : 'completed',
        dependencies: [analysisStepId],
    });

    const executionDependencies = [clarificationStepId];
    const executionStepIds: string[] = [];
    for (const task of request.tasks) {
        const stepId = randomUUID();
        executionStepIds.push(stepId);
        steps.push({
            stepId,
            taskId: task.id,
            kind: 'execution',
            title: task.title,
            description: task.objective,
            status: request.clarification.required ? 'blocked' : 'pending',
            dependencies: [...executionDependencies, ...task.dependencies],
        });
    }

    const reductionStepId = randomUUID();
    steps.push({
        stepId: reductionStepId,
        kind: 'reduction',
        title: 'Reduce execution output',
        description: 'Condense raw execution output into canonical, UI, and TTS payloads.',
        status: request.clarification.required ? 'blocked' : 'pending',
        dependencies: executionStepIds,
    });

    steps.push({
        stepId: randomUUID(),
        kind: 'presentation',
        title: 'Present final result',
        description: 'Present the reduced result to the user through the appropriate channels.',
        status: request.clarification.required ? 'blocked' : 'pending',
        dependencies: [reductionStepId],
    });

    return {
        workRequestId: request.id,
        runMode: request.tasks.length > 1 ? 'dag' : 'single',
        steps,
    };
}

export function buildExecutionQuery(request: FrozenWorkRequest): string {
    return request.tasks
        .map((task) => {
            const parts = [task.objective];
            if (task.constraints.length > 0) {
                parts.push(`约束：${task.constraints.join('；')}`);
            }
            if (task.acceptanceCriteria.length > 0) {
                parts.push(`验收标准：${task.acceptanceCriteria.join('；')}`);
            }
            return parts.join('\n');
        })
        .join('\n\n');
}

export function reduceWorkResult(input: {
    canonicalResult: string;
    request: FrozenWorkRequest;
    artifacts?: string[];
}): PresentationPayload {
    const canonicalResult = cleanScheduledTaskResultText(input.canonicalResult) || input.canonicalResult.trim();
    const uiSummary = canonicalResult;
    const normalizedForSpeech = normalizeScheduledTaskResultText(canonicalResult);
    const ttsSummary =
        input.request.presentation.ttsMode === 'full' || input.request.presentation.ttsMaxChars <= 0
            ? normalizedForSpeech
            : normalizedForSpeech.slice(0, input.request.presentation.ttsMaxChars);

    return {
        canonicalResult,
        uiSummary,
        ttsSummary,
        artifacts: input.artifacts ?? [],
    };
}

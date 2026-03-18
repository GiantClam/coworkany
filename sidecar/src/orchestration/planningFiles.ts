import * as fs from 'fs';
import * as path from 'path';
import { type ExecutionPlan, type FrozenWorkRequest } from './workRequestSchema';

type PlanningStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'skipped';

function ensurePlanningDir(workspacePath: string): string {
    const dir = path.join(workspacePath, '.coworkany');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function timestamp(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function toCheckbox(status: PlanningStatus): string {
    return status === 'completed' || status === 'skipped' ? '[x]' : '[ ]';
}

function toStatusLabel(status: PlanningStatus): string {
    return status === 'pending' ? '' : ` (${status})`;
}

function renderPlanStepLine(stepNumber: number, description: string, status: PlanningStatus): string {
    return `- ${toCheckbox(status)} Step ${stepNumber}: ${description}${toStatusLabel(status)}`;
}

function renderTaskPlan(request: FrozenWorkRequest, plan: ExecutionPlan): string {
    const goal = request.tasks.map((task) => task.objective).join(' | ') || request.sourceText.trim();
    const assumptions = request.clarification.assumptions.length > 0
        ? request.clarification.assumptions.join('；')
        : 'None';
    const preferredSkills = Array.from(
        new Set(request.tasks.flatMap((task) => task.preferredSkills))
    ).join(', ') || 'None';
    const clarificationState = request.clarification.required
        ? request.clarification.questions.join(' ')
        : 'Not required';

    const lines = [
        '# Task Plan',
        '',
        `Created: ${timestamp()}`,
        `**Goal**: ${goal}`,
        `**Work Request ID**: ${request.id}`,
        `**Mode**: ${request.mode}`,
        `**Source Text**: ${request.sourceText.trim()}`,
        `**Preferred Skills**: ${preferredSkills}`,
        `**Assumptions**: ${assumptions}`,
        `**Clarification**: ${clarificationState}`,
        '',
        '## Steps',
        '',
        ...plan.steps.map((step, index) => renderPlanStepLine(index + 1, step.description, toPlanningStatus(step.status))),
    ];

    return lines.join('\n') + '\n';
}

function toPlanningStatus(status: ExecutionPlan['steps'][number]['status']): PlanningStatus {
    return status === 'running' ? 'in_progress' : status;
}

function appendMarkdownLine(filePath: string, initialContent: string, line: string): void {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, initialContent, 'utf-8');
    }
    fs.appendFileSync(filePath, line, 'utf-8');
}

export function shouldUsePlanningFiles(request: FrozenWorkRequest): boolean {
    return request.tasks.some((task) => task.preferredSkills.includes('planning-with-files'));
}

export function ensurePlanningFilesForWorkRequest(input: {
    request: FrozenWorkRequest;
    plan: ExecutionPlan;
}): {
    planPath: string;
    findingsPath: string;
    progressPath: string;
    seeded: boolean;
} | undefined {
    if (!shouldUsePlanningFiles(input.request)) {
        return undefined;
    }

    const dir = ensurePlanningDir(input.request.workspacePath);
    const planPath = path.join(dir, 'task_plan.md');
    const findingsPath = path.join(dir, 'findings.md');
    const progressPath = path.join(dir, 'progress.md');
    const planMarker = `**Work Request ID**: ${input.request.id}`;
    const existingPlan = fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf-8') : '';
    const seeded = !existingPlan.includes(planMarker);

    if (seeded) {
        fs.writeFileSync(planPath, renderTaskPlan(input.request, input.plan), 'utf-8');
    }

    if (!fs.existsSync(findingsPath)) {
        fs.writeFileSync(findingsPath, '# Findings\n\nResearch discoveries and execution notes.\n', 'utf-8');
    }

    if (!fs.existsSync(progressPath)) {
        fs.writeFileSync(progressPath, `# Progress Log\n\nSession started at ${timestamp()}\n`, 'utf-8');
    }

    if (seeded) {
        appendPlanningProgressEntry(
            input.request.workspacePath,
            `Initialized control-plane plan for work request ${input.request.id}.`
        );
        if (input.request.clarification.assumptions.length > 0) {
            appendPlanningFinding(
                input.request.workspacePath,
                `Assumptions: ${input.request.clarification.assumptions.join('；')}`,
                'assumptions'
            );
        }
    }

    return {
        planPath,
        findingsPath,
        progressPath,
        seeded,
    };
}

export function updatePlanningStepStatus(input: {
    workspacePath: string;
    stepNumber: number;
    status: PlanningStatus;
    description?: string;
    note?: string;
}): void {
    const planPath = path.join(ensurePlanningDir(input.workspacePath), 'task_plan.md');
    if (!fs.existsSync(planPath)) {
        return;
    }

    const content = fs.readFileSync(planPath, 'utf-8');
    const stepRegex = new RegExp(`^- \\[[ x]\\] Step ${input.stepNumber}: (.*?)(?: \\((?:in_progress|completed|failed|blocked|skipped)\\))?$`, 'm');
    const match = content.match(stepRegex);
    if (!match) {
        return;
    }

    const description = input.description?.trim() || match[1].trim();
    const nextContent = content.replace(
        stepRegex,
        renderPlanStepLine(input.stepNumber, description, input.status)
    );
    fs.writeFileSync(planPath, nextContent, 'utf-8');

    if (input.note) {
        appendPlanningProgressEntry(input.workspacePath, input.note);
    }
}

export function appendPlanningProgressEntry(workspacePath: string, entry: string): void {
    const progressPath = path.join(ensurePlanningDir(workspacePath), 'progress.md');
    const line = `\n- [${timestamp()}] ${entry}\n`;
    appendMarkdownLine(progressPath, `# Progress Log\n\nSession started at ${timestamp()}\n`, line);
}

export function appendPlanningFinding(workspacePath: string, finding: string, category?: string): void {
    const findingsPath = path.join(ensurePlanningDir(workspacePath), 'findings.md');
    const categoryLabel = category ? ` [${category}]` : '';
    const entry = `\n### ${timestamp()}${categoryLabel}\n\n${finding}\n`;
    appendMarkdownLine(findingsPath, '# Findings\n\nResearch discoveries and execution notes.\n', entry);
}

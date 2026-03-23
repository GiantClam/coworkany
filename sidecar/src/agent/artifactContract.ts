import type { DeliverableContract } from '../orchestration/workRequestSchema';

export type ArtifactKind =
    | 'file'
    | 'format'
    | 'sections'
    | 'language'
    | 'length'
    | 'keywords'
    | 'tool_call';

export interface ArtifactEvidence {
    files: string[];
    toolsUsed: string[];
    outputText: string;
}

export interface ArtifactRequirement {
    id: string;
    kind: ArtifactKind;
    description: string;
    strictness: 'hard' | 'soft';
    optional?: boolean;
    payload: Record<string, unknown>;
}

export interface ArtifactContract {
    sourceQuery: string;
    requirements: ArtifactRequirement[];
}

export interface ArtifactContractEvaluation {
    passed: boolean;
    failed: Array<{
        requirementId: string;
        description: string;
        reason: string;
        optional?: boolean;
    }>;
    warnings: string[];
}

export interface ArtifactContractTelemetry {
    timestamp: string;
    query: string;
    passed: boolean;
    requirementResults: Array<{
        requirementId: string;
        kind: ArtifactKind;
        strictness: 'hard' | 'soft';
        passed: boolean;
        reason?: string;
    }>;
    evidenceSummary: {
        filesCount: number;
        toolsUsedCount: number;
        outputChars: number;
    };
}

export interface DegradedOutputHint {
    hasDegradedOutput: boolean;
    degradedArtifacts: string[];
}

const FILE_RULES: Array<{ pattern: RegExp; extension: string; description: string }> = [
    { pattern: /\bpptx\b|\bppt\b|powerpoint|presentation|演示文稿|幻灯片|简报/i, extension: '.pptx', description: '需要PPT/PPTX演示文稿文件' },
    { pattern: /\bpdf\b|导出pdf/i, extension: '.pdf', description: '需要PDF文件' },
    { pattern: /\bdocx\b|\bword\b|word文档/i, extension: '.docx', description: '需要Word文档文件' },
    { pattern: /\bxlsx\b|\bexcel\b/i, extension: '.xlsx', description: '需要Excel文件' },
    { pattern: /\bjson\b/i, extension: '.json', description: '需要JSON文件' },
];

const SECTION_HINTS: string[] = ['包含', '需要包含', 'include', 'must include', '目录'];
const EXPLICIT_FILE_PATH_PATTERN = /([A-Za-z0-9_./\-\u4e00-\u9fa5]+\.(?:md|txt|docx|pptx|pdf|xlsx|json))/ig;
const EXPLICIT_OUTPUT_TARGET_PATTERNS: RegExp[] = [
    /(?:保存到|写入到|写到|输出到|导出到|导出为|生成到)\s*[:："]?\s*([A-Za-z0-9_./\-\u4e00-\u9fa5]+\.(?:md|txt|docx|pptx|pdf|xlsx|json))/ig,
    /(?:save to|write to|output to|export to|export as)\s*[:"]?\s*([A-Za-z0-9_./\-\u4e00-\u9fa5]+\.(?:md|txt|docx|pptx|pdf|xlsx|json))/ig,
];
const EXTENSION_TO_DESCRIPTION: Record<string, string> = {
    '.md': '需要Markdown文件',
    '.txt': '需要文本文件',
    '.docx': '需要Word文档文件',
    '.pptx': '需要PPT/PPTX演示文稿文件',
    '.pdf': '需要PDF文件',
    '.xlsx': '需要Excel文件',
    '.json': '需要JSON文件',
};

function normalizePath(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function uniq<T>(items: T[]): T[] {
    return Array.from(new Set(items));
}

function normalizeExtensionFromPath(value: string): string {
    const normalized = value.trim().toLowerCase();
    const dotIndex = normalized.lastIndexOf('.');
    return dotIndex >= 0 ? normalized.slice(dotIndex) : normalized;
}

function extractExplicitOutputArtifactExtensions(query: string): string[] {
    const matches: string[] = [];
    for (const pattern of EXPLICIT_OUTPUT_TARGET_PATTERNS) {
        const found = query.matchAll(pattern);
        for (const match of found) {
            if (match[1]) matches.push(match[1]);
        }
    }

    if (matches.length === 0) {
        return [];
    }

    return uniq(matches.map((match) => {
        return normalizeExtensionFromPath(match);
    }));
}

function extractSectionRequirements(query: string): ArtifactRequirement[] {
    const requirements: ArtifactRequirement[] = [];
    const hasSectionSignal = SECTION_HINTS.some(h => query.toLowerCase().includes(h.toLowerCase()));
    if (!hasSectionSignal) return requirements;

    const lineItems = query
        .split(/\n|。|；|;|\./)
        .map(s => s.trim())
        .filter(Boolean);

    const numbered = lineItems
        .filter(s => /^\d+[\)\.:：、\s]/.test(s))
        .map(s => s.replace(/^\d+[\)\.:：、\s]*/, '').trim())
        .filter(s => s.length > 1);

    if (numbered.length > 0) {
            requirements.push({
                id: 'sections-numbered',
                kind: 'sections',
                description: `输出需覆盖至少 ${numbered.length} 个指定章节`,
                strictness: 'hard',
                payload: { sections: numbered, minCount: numbered.length },
            });
    }

    return requirements;
}

function extractLanguageRequirement(query: string): ArtifactRequirement[] {
    const requirements: ArtifactRequirement[] = [];
    if (/中文|汉语|chinese|zh-cn/i.test(query)) {
        requirements.push({
            id: 'language-zh',
            kind: 'language',
            description: '输出语言应为中文',
            strictness: 'soft',
            payload: { language: 'zh' },
        });
    }
    if (/english|英文|en-us/i.test(query)) {
        requirements.push({
            id: 'language-en',
            kind: 'language',
            description: '输出语言应为英文',
            strictness: 'soft',
            payload: { language: 'en' },
        });
    }
    return requirements;
}

function extractLengthRequirement(query: string): ArtifactRequirement[] {
    const requirements: ArtifactRequirement[] = [];
    const pageMatch = query.match(/(\d+)\s*(页|slides?|pages?)/i);
    if (pageMatch) {
        const min = Number(pageMatch[1]);
        if (Number.isFinite(min) && min > 0) {
            requirements.push({
                id: 'length-pages',
                kind: 'length',
                description: `内容应覆盖至少 ${min} 页/段`,
                strictness: 'soft',
                payload: { minUnits: min },
            });
        }
    }
    return requirements;
}

function extractKeywordRequirements(query: string): ArtifactRequirement[] {
    const requirements: ArtifactRequirement[] = [];

    // Pattern examples:
    // - 关键词: AI, 环卫, 2026
    // - 关键字：趋势、案例、展望
    const match = query.match(/关键[词字]\s*[:：]\s*([^\n。]+)/i);
    if (!match) return requirements;

    const raw = match[1] || '';
    const keywords = raw
        .split(/[、,，;；|]/)
        .map(s => s.trim())
        .filter(Boolean)
        .filter(s => s.length >= 2);

    if (keywords.length > 0) {
        requirements.push({
            id: 'keywords-core',
            kind: 'keywords',
            description: `输出应包含指定关键词（至少 ${keywords.length} 个）`,
            strictness: 'soft',
            payload: { keywords, minCount: keywords.length },
        });
    }

    return requirements;
}

function extractToolCallRequirements(query: string): ArtifactRequirement[] {
    const requirements: ArtifactRequirement[] = [];

    const knownToolHints: Array<{ pattern: RegExp; tool: string }> = [
        { pattern: /search_web|网页搜索|先搜索|联网搜索/i, tool: 'search_web' },
        { pattern: /write_to_file|写入文件|保存到文件/i, tool: 'write_to_file' },
        { pattern: /run_command|命令行|执行命令|运行(?:代码|程序|脚本|它)?|执行(?:代码|程序|脚本|它)?|跑一下|test it|verify it|run it|execute it/i, tool: 'run_command' },
    ];

    const tools = knownToolHints
        .filter(h => h.pattern.test(query))
        .map(h => h.tool);

    if (tools.length > 0) {
        requirements.push({
            id: 'tool-call-required',
            kind: 'tool_call',
            description: '流程应调用指定关键工具',
            strictness: 'soft',
            payload: { tools: uniq(tools) },
        });
    }

    return requirements;
}

function extractPlannedDeliverableRequirements(
    deliverables: DeliverableContract[] | undefined
): ArtifactRequirement[] {
    if (!deliverables || deliverables.length === 0) {
        return [];
    }

    const requirements: ArtifactRequirement[] = [];

    for (const deliverable of deliverables) {
        if (deliverable.type !== 'report_file' && deliverable.type !== 'artifact_file') {
            continue;
        }

        const normalizedPath = normalizePath(deliverable.path);
        const normalizedFormat = typeof deliverable.format === 'string'
            ? deliverable.format.trim().toLowerCase()
            : '';
        const extension = normalizedPath
            ? normalizeExtensionFromPath(normalizedPath)
            : normalizedFormat.length > 0 &&
                normalizedFormat !== 'report' &&
                normalizedFormat !== 'table' &&
                normalizedFormat !== 'artifact' &&
                normalizedFormat !== 'chat_message'
                ? `.${normalizedFormat}`
                : null;

        if (!extension) {
            continue;
        }

        requirements.push({
            id: `planned-file-${deliverable.id}`,
            kind: 'file',
            description: deliverable.path
                ? `需要按计划产出文件：${deliverable.path}`
                : `需要按计划产出 ${extension} 文件`,
            strictness: deliverable.required ? 'hard' : 'soft',
            payload: {
                extension,
                path: normalizedPath ?? undefined,
                source: 'planned_deliverable',
            },
        });
    }

    return requirements;
}

export function buildArtifactContract(
    query: string,
    deliverables?: DeliverableContract[]
): ArtifactContract {
    const requirements: ArtifactRequirement[] = [];
    const explicitPathMentions = query.match(EXPLICIT_FILE_PATH_PATTERN) || [];
    const explicitExtensions = extractExplicitOutputArtifactExtensions(query);
    const hasExplicitFileMention = explicitPathMentions.length > 0;
    const hasExplicitFileTarget = explicitExtensions.length > 0;

    for (const rule of FILE_RULES) {
        if (hasExplicitFileMention && !hasExplicitFileTarget) {
            continue;
        }
        if (hasExplicitFileTarget && !explicitExtensions.includes(rule.extension)) {
            continue;
        }
        if (rule.pattern.test(query)) {
            requirements.push({
                id: `file-${rule.extension}`,
                kind: 'file',
                description: rule.description,
                strictness: 'hard',
                payload: { extension: rule.extension },
            });
        }
    }

    for (const extension of explicitExtensions) {
        requirements.push({
            id: `file-explicit-${extension}`,
            kind: 'file',
            description: EXTENSION_TO_DESCRIPTION[extension] || `需要 ${extension} 文件`,
            strictness: 'hard',
            payload: { extension },
        });
    }

    requirements.push(...extractSectionRequirements(query));
    requirements.push(...extractLanguageRequirement(query));
    requirements.push(...extractLengthRequirement(query));
    requirements.push(...extractKeywordRequirements(query));
    requirements.push(...extractToolCallRequirements(query));
    requirements.push(...extractPlannedDeliverableRequirements(deliverables));

    return {
        sourceQuery: query,
        requirements: uniq(requirements.map(r => JSON.stringify(r))).map(s => JSON.parse(s)),
    };
}

export function evaluateArtifactContract(
    contract: ArtifactContract,
    evidence: ArtifactEvidence
): ArtifactContractEvaluation {
    const failed: ArtifactContractEvaluation['failed'] = [];
    const warnings: string[] = [];
    const text = evidence.outputText || '';

    for (const req of contract.requirements) {
        if (req.kind === 'file') {
            const ext = String(req.payload.extension || '').toLowerCase();
            const ok = evidence.files.some(file => file.toLowerCase().endsWith(ext));
            if (!ok) {
                const entry = {
                    requirementId: req.id,
                    description: req.description,
                    reason: `缺少扩展名为 ${ext} 的文件产物`,
                    optional: req.optional,
                };
                if (req.strictness === 'hard') {
                    failed.push(entry);
                } else {
                    warnings.push(entry.reason);
                }
            }
            continue;
        }

        if (req.kind === 'sections') {
            const sections = (req.payload.sections as string[]) || [];
            const minCount = Number(req.payload.minCount || sections.length || 0);
            let hitCount = 0;
            for (const sec of sections) {
                if (sec && text.toLowerCase().includes(sec.toLowerCase())) {
                    hitCount++;
                }
            }
            if (hitCount < minCount) {
                const entry = {
                    requirementId: req.id,
                    description: req.description,
                    reason: `章节命中不足：命中 ${hitCount}，要求至少 ${minCount}`,
                    optional: req.optional,
                };
                if (req.strictness === 'hard') {
                    failed.push(entry);
                } else {
                    warnings.push(entry.reason);
                }
            }
            continue;
        }

        if (req.kind === 'language') {
            const lang = String(req.payload.language || '');
            if (lang === 'zh') {
                const hasZh = /[\u4e00-\u9fff]/.test(text);
                if (!hasZh) {
                    const entry = {
                        requirementId: req.id,
                        description: req.description,
                        reason: '输出中缺少中文字符',
                        optional: req.optional,
                    };
                    if (req.strictness === 'hard') {
                        failed.push(entry);
                    } else {
                        warnings.push(entry.reason);
                    }
                }
            }
            if (lang === 'en') {
                const hasEn = /[a-zA-Z]{4,}/.test(text);
                if (!hasEn) {
                    const entry = {
                        requirementId: req.id,
                        description: req.description,
                        reason: '输出中缺少英文文本',
                        optional: req.optional,
                    };
                    if (req.strictness === 'hard') {
                        failed.push(entry);
                    } else {
                        warnings.push(entry.reason);
                    }
                }
            }
            continue;
        }

        if (req.kind === 'length') {
            const minUnits = Number(req.payload.minUnits || 0);
            if (minUnits > 0) {
                const unitHits = (text.match(/(^|\n)\s*(第\s*\d+\s*页|slide\s*\d+|##\s+)/gi) || []).length;
                if (unitHits < minUnits) {
                    warnings.push(`长度要求可能未满足：检测到 ${unitHits} 个单元，要求至少 ${minUnits}`);
                }
            }
            continue;
        }

        if (req.kind === 'keywords') {
            const keywords = ((req.payload.keywords as string[]) || []).filter(Boolean);
            const minCount = Number(req.payload.minCount || keywords.length || 0);
            let hitCount = 0;
            for (const keyword of keywords) {
                if (text.toLowerCase().includes(keyword.toLowerCase())) {
                    hitCount++;
                }
            }
            if (hitCount < minCount) {
                const entry = {
                    requirementId: req.id,
                    description: req.description,
                    reason: `关键词命中不足：命中 ${hitCount}，要求至少 ${minCount}`,
                    optional: req.optional,
                };
                if (req.strictness === 'hard') {
                    failed.push(entry);
                } else {
                    warnings.push(entry.reason);
                }
            }
            continue;
        }

        if (req.kind === 'tool_call') {
            const requiredTools = ((req.payload.tools as string[]) || []).map(t => t.toLowerCase());
            const usedTools = evidence.toolsUsed.map(t => t.toLowerCase());
            const missingTools = requiredTools.filter(t => !usedTools.includes(t));
            if (missingTools.length > 0) {
                const entry = {
                    requirementId: req.id,
                    description: req.description,
                    reason: `缺少关键工具调用：${missingTools.join(', ')}`,
                    optional: req.optional,
                };
                if (req.strictness === 'hard') {
                    failed.push(entry);
                } else {
                    warnings.push(entry.reason);
                }
            }
            continue;
        }
    }

    const blockingFailures = failed.filter(f => !f.optional);
    return {
        passed: blockingFailures.length === 0,
        failed,
        warnings,
    };
}

export function extractArtifactPathsFromToolResult(toolName: string, result: unknown): string[] {
    const paths = new Set<string>();
    const normalizedToolName = toolName.toLowerCase();

    if (result && typeof result === 'object') {
        const objectResult = result as Record<string, unknown>;

        const candidates = [
            objectResult.path,
            objectResult.outputPath,
            objectResult.filePath,
            objectResult.targetPath,
        ];

        for (const c of candidates) {
            const p = normalizePath(c);
            if (p) paths.add(p);
        }

        const files = objectResult.files;
        if (Array.isArray(files)) {
            for (const f of files) {
                const p = normalizePath(f);
                if (p) paths.add(p);
            }
        }
    }

    // Conservative fallback for known file-creating tools
    if ((normalizedToolName === 'write_to_file' || normalizedToolName === 'replace_file_content') && paths.size === 0) {
        return [];
    }

    return Array.from(paths);
}

export function detectDegradedOutputs(
    contract: ArtifactContract,
    files: string[] | undefined
): DegradedOutputHint {
    const generatedFiles = files ?? [];
    if (generatedFiles.length === 0) {
        return { hasDegradedOutput: false, degradedArtifacts: [] };
    }

    const requiredExts = contract.requirements
        .filter(r => r.kind === 'file')
        .map(r => String(r.payload.extension || '').toLowerCase())
        .filter(Boolean);

    if (requiredExts.length === 0) {
        return { hasDegradedOutput: false, degradedArtifacts: [] };
    }

    const degradedArtifacts = generatedFiles.filter(file => {
        const lower = file.toLowerCase();
        const isTarget = requiredExts.some(ext => lower.endsWith(ext));
        if (isTarget) return false;
        return /\.(md|txt|json|csv|html)$/i.test(lower);
    });

    return {
        hasDegradedOutput: degradedArtifacts.length > 0,
        degradedArtifacts,
    };
}

export function buildArtifactTelemetry(
    contract: ArtifactContract,
    evidence: ArtifactEvidence,
    evaluation: ArtifactContractEvaluation
): ArtifactContractTelemetry {
    const failedIds = new Set(evaluation.failed.map(f => f.requirementId));

    const requirementResults = contract.requirements.map(req => {
        const failed = evaluation.failed.find(f => f.requirementId === req.id);
        return {
            requirementId: req.id,
            kind: req.kind,
            strictness: req.strictness,
            passed: !failedIds.has(req.id),
            reason: failed?.reason,
        };
    });

    return {
        timestamp: new Date().toISOString(),
        query: contract.sourceQuery,
        passed: evaluation.passed,
        requirementResults,
        evidenceSummary: {
            filesCount: evidence.files.length,
            toolsUsedCount: evidence.toolsUsed.length,
            outputChars: evidence.outputText.length,
        },
    };
}

/**
 * CoworkAny - Precipitator (Knowledge/Skill Precipitation Engine)
 *
 * Saves validated learning outcomes as reusable knowledge entries or skills.
 * Follows the SKILL.md format for auto-generated skills.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
    ProcessedKnowledge,
    ExperimentResult,
    PrecipitationType,
    PrecipitationDecision,
    PrecipitationResult,
    GeneratedSkill,
    GeneratedRuntimeToolSpec,
    SelfLearningConfig,
    SkillGenerationStrategy,
    DependencyResolution,
} from './types';
import { DEFAULT_CONFIG, DEFAULT_SKILL_GENERATION_STRATEGY } from './types';
import type { DependencyResolver } from './dependencyResolver';

// ============================================================================
// Constants
// ============================================================================

const VAULT_SUBDIR = 'vault/self-learned';
const SKILLS_SUBDIR = 'skills/auto-generated';
const MIN_SUCCESS_RATE_FOR_SKILL = 0.8;
const MIN_VALIDATIONS_FOR_AUTO_SKILL = 3;

// ============================================================================
// Types
// ============================================================================

export interface PrecipitatorDependencies {
    /**
     * Base directory for data storage (e.g., ~/.coworkany)
     */
    dataDir: string;

    /**
     * Install a generated skill
     */
    installSkill?: (skillDir: string) => Promise<void>;

    /**
     * Add knowledge to RAG index
     */
    indexKnowledge?: (path: string, content: string, metadata: Record<string, unknown>) => Promise<void>;

    /**
     * Dependency resolver for composing skills from existing tools/skills
     */
    dependencyResolver?: DependencyResolver;

    /**
     * Hot-reload callback: called after a new skill is installed
     * so the tool registry can register the new tools immediately
     */
    onSkillInstalled?: (skillId: string, skillDir: string, manifest: Record<string, unknown>) => void;

    /**
     * Hot-register a generated runtime tool derived from the learned skill
     */
    onGeneratedTool?: (tool: GeneratedRuntimeToolSpec, skillDir: string) => void;
}

// ============================================================================
// Precipitator Class
// ============================================================================

export class Precipitator {
    private config: SelfLearningConfig;
    private deps: PrecipitatorDependencies;
    private vaultDir: string;
    private skillsDir: string;
    private skillStrategy: SkillGenerationStrategy;

    constructor(
        deps: PrecipitatorDependencies,
        config?: Partial<SelfLearningConfig>,
        skillStrategy?: Partial<SkillGenerationStrategy>
    ) {
        this.deps = deps;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.skillStrategy = { ...DEFAULT_SKILL_GENERATION_STRATEGY, ...skillStrategy };
        this.vaultDir = path.join(deps.dataDir, VAULT_SUBDIR);
        this.skillsDir = path.join(deps.dataDir, SKILLS_SUBDIR);

        // Ensure directories exist
        this.ensureDirectories();
    }

    /**
     * Ensure storage directories exist
     */
    private ensureDirectories(): void {
        if (!fs.existsSync(this.vaultDir)) {
            fs.mkdirSync(this.vaultDir, { recursive: true });
        }
        if (!fs.existsSync(this.skillsDir)) {
            fs.mkdirSync(this.skillsDir, { recursive: true });
        }
    }

    // ========================================================================
    // Decision Making
    // ========================================================================

    /**
     * Decide how to precipitate the learning outcome
     */
    decidePrecipitationType(
        knowledge: ProcessedKnowledge,
        experiment: ExperimentResult
    ): PrecipitationDecision {
        // Check confidence threshold
        if (knowledge.confidence < this.config.minConfidenceToSave) {
            return {
                type: 'knowledge_entry',
                reason: `Low confidence (${knowledge.confidence.toFixed(2)}), saving as draft knowledge`,
                targetPath: this.getKnowledgePath(knowledge, 'draft'),
                requiresUserApproval: true,
            };
        }

        // Calculate success metrics
        const passedTests = experiment.testResults.filter(r => r.passed).length;
        const successRate = experiment.testResults.length > 0
            ? passedTests / experiment.testResults.length
            : 0;

        // High success rate + code template = potential skill
        if (
            successRate >= MIN_SUCCESS_RATE_FOR_SKILL &&
            knowledge.codeTemplate &&
            (knowledge.type === 'procedure' || knowledge.type === 'api_reference')
        ) {
            // Auto skill if high confidence and validated
            if (
                knowledge.confidence >= this.config.minConfidenceToAutoUse &&
                experiment.testResults.length >= MIN_VALIDATIONS_FOR_AUTO_SKILL
            ) {
                return {
                    type: 'skill_auto',
                    reason: `High success rate (${(successRate * 100).toFixed(0)}%) and confidence, auto-generating skill`,
                    targetPath: this.getSkillPath(knowledge),
                    requiresUserApproval: false,
                };
            }

            // Otherwise create draft skill for review
            return {
                type: 'skill_draft',
                reason: `Good success rate but needs user review before activation`,
                targetPath: this.getSkillPath(knowledge),
                requiresUserApproval: true,
            };
        }

        // Procedure type with steps
        if (knowledge.type === 'procedure' && knowledge.steps && knowledge.steps.length > 0) {
            return {
                type: 'procedure',
                reason: 'Multi-step procedure with actionable steps',
                targetPath: this.getKnowledgePath(knowledge, 'procedures'),
                requiresUserApproval: false,
            };
        }

        // Default to knowledge entry
        return {
            type: 'knowledge_entry',
            reason: 'Standard knowledge entry',
            targetPath: this.getKnowledgePath(knowledge, 'concepts'),
            requiresUserApproval: false,
        };
    }

    // ========================================================================
    // Knowledge Precipitation
    // ========================================================================

    /**
     * Save as knowledge entry (Markdown file in vault)
     */
    async saveAsKnowledge(
        knowledge: ProcessedKnowledge,
        experiment: ExperimentResult,
        subdir: string = 'concepts'
    ): Promise<PrecipitationResult> {
        const targetPath = this.getKnowledgePath(knowledge, subdir);

        try {
            // Generate markdown content
            const content = this.generateKnowledgeMarkdown(knowledge, experiment);

            // Ensure directory exists
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Write file
            fs.writeFileSync(targetPath, content, 'utf-8');

            // Index in RAG if available
            if (this.deps.indexKnowledge) {
                await this.deps.indexKnowledge(targetPath, content, {
                    type: knowledge.type,
                    keywords: knowledge.sourceResearch.gap.keywords,
                    confidence: knowledge.confidence,
                    autoGenerated: true,
                });
            }

            return {
                success: true,
                type: 'knowledge_entry',
                path: targetPath,
                entityId: knowledge.id,
            };
        } catch (error) {
            return {
                success: false,
                type: 'knowledge_entry',
                path: targetPath,
                entityId: knowledge.id,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Generate markdown content for knowledge
     */
    private generateKnowledgeMarkdown(
        knowledge: ProcessedKnowledge,
        experiment: ExperimentResult
    ): string {
        const lines: string[] = [];
        const date = new Date().toISOString().split('T')[0];

        // YAML frontmatter
        lines.push('---');
        lines.push(`title: "${knowledge.title}"`);
        lines.push(`type: ${knowledge.type}`);
        lines.push(`created: ${date}`);
        lines.push(`confidence: ${knowledge.confidence.toFixed(2)}`);
        lines.push(`keywords: [${knowledge.sourceResearch.gap.keywords.map(k => `"${k}"`).join(', ')}]`);
        lines.push(`auto_generated: true`);
        lines.push('---');
        lines.push('');

        // Title and summary
        lines.push(`# ${knowledge.title}`);
        lines.push('');
        lines.push(knowledge.summary);
        lines.push('');

        // Prerequisites
        if (knowledge.prerequisites.length > 0) {
            lines.push('## Prerequisites');
            lines.push('');
            for (const prereq of knowledge.prerequisites) {
                lines.push(`- ${prereq}`);
            }
            lines.push('');
        }

        // Dependencies
        if (knowledge.dependencies.length > 0) {
            lines.push('## Dependencies');
            lines.push('');
            lines.push('```bash');
            for (const dep of knowledge.dependencies) {
                lines.push(`pip install ${dep}  # or npm install ${dep}`);
            }
            lines.push('```');
            lines.push('');
        }

        // Steps (if procedure)
        if (knowledge.steps && knowledge.steps.length > 0) {
            lines.push('## Steps');
            lines.push('');
            for (let i = 0; i < knowledge.steps.length; i++) {
                lines.push(`${i + 1}. ${knowledge.steps[i]}`);
            }
            lines.push('');
        }

        // Code template
        if (knowledge.codeTemplate) {
            lines.push('## Code Example');
            lines.push('');
            lines.push('```python');
            lines.push(knowledge.codeTemplate);
            lines.push('```');
            lines.push('');
        }

        // Detailed content
        lines.push('## Details');
        lines.push('');
        lines.push(knowledge.detailedContent);
        lines.push('');

        // Validation results
        lines.push('## Validation');
        lines.push('');
        lines.push(`- **Tests Run**: ${experiment.testResults.length}`);
        lines.push(`- **Passed**: ${experiment.testResults.filter(r => r.passed).length}`);
        lines.push(`- **Dependencies Installed**: ${experiment.installedDependencies.join(', ') || 'None'}`);

        if (experiment.discoveredIssues.length > 0) {
            lines.push('');
            lines.push('### Known Issues');
            for (const issue of experiment.discoveredIssues) {
                lines.push(`- ${issue}`);
            }
        }

        if (experiment.refinements.length > 0) {
            lines.push('');
            lines.push('### Refinements Applied');
            for (const ref of experiment.refinements) {
                lines.push(`- ${ref}`);
            }
        }

        // Sources
        lines.push('');
        lines.push('## Sources');
        lines.push('');
        for (const source of knowledge.sourceResearch.sources.slice(0, 5)) {
            lines.push(`- [${source.title}](${source.url}) (reliability: ${(source.reliability * 100).toFixed(0)}%)`);
        }

        return lines.join('\n');
    }

    // ========================================================================
    // Skill Generation
    // ========================================================================

    /**
     * Generate a skill from knowledge
     * Uses dependency resolver to compose from existing tools/skills when possible
     */
    async generateSkill(
        knowledge: ProcessedKnowledge,
        experiment: ExperimentResult
    ): Promise<GeneratedSkill> {
        const skillId = this.generateSkillId(knowledge);
        const skillName = this.generateSkillName(knowledge);

        // Resolve dependencies - prefer existing tools/skills over inline code
        let dependencyDeclarations = {
            requires: { tools: [] as string[], skills: [] as string[] },
            allowedTools: [] as string[],
            inlineCode: {} as Record<string, string>,
        };
        let dependencyResolution: DependencyResolution | undefined;

        if (this.deps.dependencyResolver && this.skillStrategy.preferExistingTools) {
            // Analyze required capabilities
            const capabilities = this.deps.dependencyResolver.analyzeRequiredCapabilities(knowledge);

            // Resolve to existing tools/skills
            dependencyResolution = await this.deps.dependencyResolver.resolveDependencies(capabilities);

            // Generate dependency declarations
            dependencyDeclarations = this.deps.dependencyResolver.generateDependencyDeclarations(
                dependencyResolution
            );
        }

        // Merge with explicitly determined tools
        const baseAllowedTools = this.determineAllowedTools(knowledge);
        const allAllowedTools = [...new Set([
            ...baseAllowedTools,
            ...dependencyDeclarations.allowedTools,
        ])];

        // Build composedFrom metadata from resolved dependencies
        const composedFrom: GeneratedSkill['manifest']['composedFrom'] = dependencyResolution ? {
            tools: dependencyResolution.resolved
                .filter(r => r.dependency.type === 'tool')
                .map(r => ({ id: r.resolvedTo, purpose: r.dependency.purpose })),
            skills: dependencyResolution.resolved
                .filter(r => r.dependency.type === 'skill')
                .map(r => ({ id: r.resolvedTo, purpose: r.dependency.purpose, version: r.version })),
        } : undefined;

        // Generate manifest with dependency info
        const manifest: GeneratedSkill['manifest'] = {
            id: skillId,
            name: skillName,
            version: '1.0.0',
            description: knowledge.summary,
            tags: [...knowledge.sourceResearch.gap.keywords, 'auto-generated', 'composable'],
            triggers: this.generateTriggers(knowledge),
            allowedTools: allAllowedTools,
            requires: {
                tools: dependencyDeclarations.requires.tools,
                skills: dependencyDeclarations.requires.skills,
                capabilities: [],
                bins: this.extractBinaries(knowledge),
                env: [],
            },
            composedFrom,
        };

        // Generate SKILL.md content with dependency info
        const skillMd = this.generateSkillMarkdown(
            knowledge,
            experiment,
            manifest,
            dependencyResolution
        );

        // Generate scripts if code template available
        const scripts: Record<string, string> = {};
        if (knowledge.codeTemplate) {
            const ext = this.detectScriptExtension(knowledge.codeTemplate);
            scripts[`main${ext}`] = knowledge.codeTemplate;
        }

        // Working code from experiment
        if (experiment.finalWorkingCode) {
            const ext = this.detectScriptExtension(experiment.finalWorkingCode);
            scripts[`validated${ext}`] = experiment.finalWorkingCode;
        }

        // Add inline fallback code if any dependencies couldn't be resolved
        if (Object.keys(dependencyDeclarations.inlineCode).length > 0) {
            for (const [name, code] of Object.entries(dependencyDeclarations.inlineCode)) {
                const ext = this.detectScriptExtension(code);
                scripts[`fallback_${name}${ext}`] = code;
            }
        }

        const generatedTool = this.generateRuntimeToolSpec(skillId, knowledge, experiment);

        return {
            manifest,
            skillMd,
            scripts: Object.keys(scripts).length > 0 ? scripts : undefined,
            generatedToolCode: generatedTool
                ? {
                    fileName: `${generatedTool.name}.generated.ts`,
                    exportName: generatedTool.name,
                    content: `// runtime-generated tool: ${generatedTool.name}`,
                }
                : undefined,
            runtimeTool: generatedTool,
        };
    }

    private generateRuntimeToolSpec(
        skillId: string,
        knowledge: ProcessedKnowledge,
        experiment: ExperimentResult
    ): GeneratedRuntimeToolSpec | undefined {
        const code = experiment.finalWorkingCode || knowledge.codeTemplate;
        if (!code) return undefined;

        const ext = this.detectScriptExtension(code);
        const language: 'python' | 'javascript' = ext === '.py' ? 'python' : 'javascript';
        const normalized = skillId.replace(/[^a-zA-Z0-9_]/g, '_');

        return {
            name: `generated_${normalized}`,
            description: `Auto-generated runtime tool from learned skill "${knowledge.title}"`,
            language,
            templateCode: code,
            sourceSkillId: skillId,
        };
    }

    /**
     * Install a generated skill
     */
    async installSkill(skill: GeneratedSkill): Promise<PrecipitationResult> {
        const skillDir = path.join(this.skillsDir, skill.manifest.id);

        try {
            // Create skill directory
            if (!fs.existsSync(skillDir)) {
                fs.mkdirSync(skillDir, { recursive: true });
            }

            // Write SKILL.md
            fs.writeFileSync(
                path.join(skillDir, 'SKILL.md'),
                skill.skillMd,
                'utf-8'
            );

            // Write scripts
            if (skill.scripts) {
                const scriptsDir = path.join(skillDir, 'scripts');
                if (!fs.existsSync(scriptsDir)) {
                    fs.mkdirSync(scriptsDir, { recursive: true });
                }

                for (const [name, content] of Object.entries(skill.scripts)) {
                    fs.writeFileSync(path.join(scriptsDir, name), content, 'utf-8');
                }
            }

            // Register skill if handler available
            if (this.deps.installSkill) {
                await this.deps.installSkill(skillDir);
            }

            // Hot-reload: notify tool registry so new skill is immediately available
            if (this.deps.onSkillInstalled) {
                try {
                    this.deps.onSkillInstalled(
                        skill.manifest.id,
                        skillDir,
                        skill.manifest as unknown as Record<string, unknown>
                    );
                    console.log(`[Precipitator] Hot-reload triggered for skill: ${skill.manifest.id}`);
                } catch (hotloadErr) {
                    console.error(`[Precipitator] Hot-reload callback failed:`, hotloadErr);
                    // Non-critical — skill is still installed on disk
                }
            }

            if (skill.runtimeTool && this.deps.onGeneratedTool) {
                try {
                    this.deps.onGeneratedTool(skill.runtimeTool, skillDir);
                    console.log(`[Precipitator] Generated runtime tool registered: ${skill.runtimeTool.name}`);
                } catch (toolErr) {
                    console.error(`[Precipitator] Runtime tool registration failed:`, toolErr);
                }
            }

            return {
                success: true,
                type: 'skill_auto',
                path: skillDir,
                entityId: skill.manifest.id,
            };
        } catch (error) {
            return {
                success: false,
                type: 'skill_auto',
                path: skillDir,
                entityId: skill.manifest.id,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Generate SKILL.md content
     */
    private generateSkillMarkdown(
        knowledge: ProcessedKnowledge,
        experiment: ExperimentResult,
        manifest: GeneratedSkill['manifest'],
        dependencyResolution?: DependencyResolution
    ): string {
        const lines: string[] = [];

        // YAML frontmatter
        lines.push('---');
        lines.push(`name: ${manifest.name}`);
        lines.push(`version: ${manifest.version}`);
        lines.push(`description: ${manifest.description}`);
        lines.push(`tags: [${manifest.tags.map(t => `"${t}"`).join(', ')}]`);
        lines.push('');
        lines.push('triggers:');
        for (const trigger of manifest.triggers) {
            lines.push(`  - "${trigger}"`);
        }
        lines.push('');
        lines.push('allowed-tools:');
        for (const tool of manifest.allowedTools) {
            lines.push(`  - ${tool}`);
        }
        lines.push('');

        // Generate requires section with all dependencies
        const hasRequires = manifest.requires && (
            manifest.requires.tools.length > 0 ||
            manifest.requires.skills.length > 0 ||
            manifest.requires.bins.length > 0 ||
            manifest.requires.env.length > 0
        );

        if (hasRequires) {
            lines.push('requires:');

            // Tools dependencies (built-in tools this skill needs)
            if (manifest.requires!.tools.length > 0) {
                lines.push('  tools:');
                for (const tool of manifest.requires!.tools) {
                    lines.push(`    - ${tool}`);
                }
            }

            // Skills dependencies (other skills this skill composes)
            if (manifest.requires!.skills.length > 0) {
                lines.push('  skills:');
                for (const skill of manifest.requires!.skills) {
                    lines.push(`    - ${skill}`);
                }
            }

            // Binary dependencies
            if (manifest.requires!.bins.length > 0) {
                lines.push('  bins:');
                for (const bin of manifest.requires!.bins) {
                    lines.push(`    - ${bin}`);
                }
            }

            // Environment dependencies
            if (manifest.requires!.env.length > 0) {
                lines.push('  env:');
                for (const env of manifest.requires!.env) {
                    lines.push(`    - ${env}`);
                }
            }
        }

        // Add composedFrom metadata for documentation
        if (manifest.composedFrom) {
            lines.push('');
            lines.push('# Composition metadata (for documentation)');
            lines.push('composed-from:');
            if (manifest.composedFrom.tools.length > 0) {
                lines.push('  tools:');
                for (const tool of manifest.composedFrom.tools) {
                    lines.push(`    - id: ${tool.id}`);
                    lines.push(`      purpose: "${tool.purpose}"`);
                }
            }
            if (manifest.composedFrom.skills.length > 0) {
                lines.push('  skills:');
                for (const skill of manifest.composedFrom.skills) {
                    lines.push(`    - id: ${skill.id}`);
                    lines.push(`      purpose: "${skill.purpose}"`);
                    if (skill.version) {
                        lines.push(`      version: "${skill.version}"`);
                    }
                }
            }
        }

        lines.push('');
        lines.push('user-invocable: true');
        lines.push('disable-model-invocation: false');
        lines.push('---');
        lines.push('');

        // Skill instructions
        lines.push(`# ${manifest.name}`);
        lines.push('');
        lines.push(`> Auto-generated skill for ${knowledge.sourceResearch.gap.keywords.join(', ')}`);
        lines.push('');
        lines.push('## Overview');
        lines.push('');
        lines.push(knowledge.summary);
        lines.push('');

        // Usage
        lines.push('## Usage');
        lines.push('');
        lines.push('This skill is triggered when the user asks about:');
        for (const trigger of manifest.triggers) {
            lines.push(`- ${trigger}`);
        }
        lines.push('');

        // Prerequisites
        if (knowledge.prerequisites.length > 0) {
            lines.push('## Prerequisites');
            lines.push('');
            for (const prereq of knowledge.prerequisites) {
                lines.push(`- ${prereq}`);
            }
            lines.push('');
        }

        // Dependencies (composable skill info)
        if (dependencyResolution && dependencyResolution.resolved.length > 0) {
            lines.push('## Composed From');
            lines.push('');
            lines.push('> This skill composes existing tools and skills for better maintainability.');
            lines.push('> When underlying tools are upgraded, this skill automatically benefits.');
            lines.push('');

            const toolDeps = dependencyResolution.resolved.filter(r => r.dependency.type === 'tool');
            const skillDeps = dependencyResolution.resolved.filter(r => r.dependency.type === 'skill');

            if (toolDeps.length > 0) {
                lines.push('### Tools Used');
                lines.push('');
                for (const dep of toolDeps) {
                    lines.push(`- \`${dep.resolvedTo}\` - ${dep.dependency.purpose}`);
                }
                lines.push('');
            }

            if (skillDeps.length > 0) {
                lines.push('### Skills Used');
                lines.push('');
                for (const dep of skillDeps) {
                    lines.push(`- \`${dep.resolvedTo}\` - ${dep.dependency.purpose}`);
                }
                lines.push('');
            }
        }

        // Steps
        if (knowledge.steps && knowledge.steps.length > 0) {
            lines.push('## Steps');
            lines.push('');
            for (let i = 0; i < knowledge.steps.length; i++) {
                lines.push(`${i + 1}. ${knowledge.steps[i]}`);
            }
            lines.push('');
        }

        // Code
        if (knowledge.codeTemplate) {
            lines.push('## Code Template');
            lines.push('');
            lines.push('Use the following code as a starting point:');
            lines.push('');
            lines.push('```python');
            lines.push(knowledge.codeTemplate);
            lines.push('```');
            lines.push('');
        }

        // Dependencies
        if (knowledge.dependencies.length > 0) {
            lines.push('## Dependencies');
            lines.push('');
            lines.push('Install required packages:');
            lines.push('');
            lines.push('```bash');
            lines.push(`pip install ${knowledge.dependencies.join(' ')}`);
            lines.push('```');
            lines.push('');
        }

        // Validation info
        lines.push('## Validation');
        lines.push('');
        lines.push(`This skill was validated with ${experiment.testResults.length} test(s), ` +
            `${experiment.testResults.filter(r => r.passed).length} passed.`);
        lines.push('');
        lines.push(`Confidence: ${(knowledge.confidence * 100).toFixed(0)}%`);

        return lines.join('\n');
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    private getKnowledgePath(knowledge: ProcessedKnowledge, subdir: string): string {
        const date = new Date().toISOString().split('T')[0];
        const slug = knowledge.sourceResearch.gap.keywords[0]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-');
        return path.join(this.vaultDir, subdir, `${date}-${slug}.md`);
    }

    private getSkillPath(knowledge: ProcessedKnowledge): string {
        const skillId = this.generateSkillId(knowledge);
        return path.join(this.skillsDir, skillId);
    }

    private generateSkillId(knowledge: ProcessedKnowledge): string {
        const keywords = knowledge.sourceResearch.gap.keywords;
        return `auto-${keywords[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    }

    private generateSkillName(knowledge: ProcessedKnowledge): string {
        const keyword = knowledge.sourceResearch.gap.keywords[0];
        return keyword.charAt(0).toUpperCase() + keyword.slice(1) + ' Assistant';
    }

    private generateTriggers(knowledge: ProcessedKnowledge): string[] {
        const triggers: string[] = [];
        const keywords = knowledge.sourceResearch.gap.keywords;

        for (const kw of keywords.slice(0, 3)) {
            triggers.push(`use ${kw}`);
            triggers.push(`help with ${kw}`);
            triggers.push(`${kw} example`);
        }

        return triggers;
    }

    private determineAllowedTools(knowledge: ProcessedKnowledge): string[] {
        const tools = ['run_python', 'run_command'];

        if (knowledge.dependencies.some(d => /^(@|react|vue|angular|express)/.test(d))) {
            tools.push('run_javascript');
        }

        return tools;
    }

    private extractBinaries(knowledge: ProcessedKnowledge): string[] {
        const bins: string[] = [];
        const content = knowledge.detailedContent + (knowledge.codeTemplate || '');

        // Common binary patterns
        const patterns = [
            /\b(ffmpeg|imagemagick|convert|mogrify)\b/gi,
            /\b(docker|kubectl|terraform)\b/gi,
            /\b(git|curl|wget)\b/gi,
            /\b(python3?|node|npm|pip)\b/gi,
        ];

        for (const pattern of patterns) {
            const matches = content.match(pattern);
            if (matches) {
                bins.push(...matches.map(m => m.toLowerCase()));
            }
        }

        return [...new Set(bins)];
    }

    private detectScriptExtension(code: string): string {
        if (/^import\s+\w+|^from\s+\w+\s+import|def\s+\w+\(/.test(code)) {
            return '.py';
        }
        if (/const\s+\w+|let\s+\w+|require\(|import\s+.*from/.test(code)) {
            return '.js';
        }
        if (/^#!\/bin\/(bash|sh)/.test(code)) {
            return '.sh';
        }
        return '.py';
    }

    // ========================================================================
    // Main Precipitation Method
    // ========================================================================

    /**
     * Precipitate knowledge based on automatic decision
     */
    /**
     * Validate a generated skill for quality (TDD for Skills — Superpowers pattern).
     *
     * Checks:
     * 1. Structural completeness (frontmatter, sections, triggers)
     * 2. Anti-rationalization coverage (discipline skills need rationalization tables)
     * 3. Actionability (concrete steps vs vague advice)
     * 4. Iron Law presence (for process/discipline skills)
     */
    validateSkillQuality(skill: GeneratedSkill): {
        valid: boolean;
        score: number;
        issues: string[];
        suggestions: string[];
    } {
        const issues: string[] = [];
        const suggestions: string[] = [];
        let score = 0;
        const maxScore = 10;

        const md = skill.skillMd;

        // 1. Structural checks
        if (md.includes('---\n') && md.indexOf('---\n', 3) > 0) {
            score += 2; // Has frontmatter
        } else {
            issues.push('Missing YAML frontmatter (---name/description---)');
        }

        if (md.includes('# ')) score += 1; // Has headings
        if (md.length > 200) score += 1; // Substantial content

        // 2. Trigger quality
        const manifest = skill.manifest;
        if (manifest.triggers && manifest.triggers.length >= 2) {
            score += 1;
        } else {
            suggestions.push('Add more trigger phrases (at least 2) for auto-activation');
        }

        // 3. Actionability — check for concrete steps
        const hasSteps = /step\s*\d|##.*\d\.|1\.\s|2\.\s/i.test(md);
        if (hasSteps) {
            score += 1;
        } else {
            suggestions.push('Add numbered steps or a clear process for the agent to follow');
        }

        // 4. Anti-pattern awareness
        const hasAntiPatterns = /anti.?pattern|red flag|never|forbidden|rationalization|don't|avoid/i.test(md);
        if (hasAntiPatterns) {
            score += 1;
        } else {
            suggestions.push('Add anti-patterns or red flags section — what should the agent NOT do?');
        }

        // 5. Verification criteria
        const hasVerification = /verif|checklist|confirm|evidence|gate/i.test(md);
        if (hasVerification) {
            score += 1;
        } else {
            suggestions.push('Add verification criteria — how does the agent know the skill was applied correctly?');
        }

        // 6. Description quality — "Use when..." trigger pattern (Superpowers CSO)
        if (manifest.description?.startsWith('Use when')) {
            score += 1;
        } else {
            suggestions.push('Description should start with "Use when..." to optimize auto-triggering');
        }

        return {
            valid: score >= 5, // Minimum threshold for installation
            score,
            issues,
            suggestions,
        };
    }

    async precipitate(
        knowledge: ProcessedKnowledge,
        experiment: ExperimentResult
    ): Promise<PrecipitationResult> {
        // Decide precipitation type
        const decision = this.decidePrecipitationType(knowledge, experiment);

        // Execute based on decision
        switch (decision.type) {
            case 'skill_auto':
            case 'skill_draft': {
                const skill = await this.generateSkill(knowledge, experiment);

                // ── TDD for Skills: Quality Validation ──────────────
                // (Superpowers pattern: Validate before installation)
                const validation = this.validateSkillQuality(skill);
                console.log(`[Precipitator] Skill "${skill.manifest.name}" quality score: ${validation.score}/10`);

                if (validation.issues.length > 0) {
                    console.log(`[Precipitator] Quality issues: ${validation.issues.join('; ')}`);
                }
                if (validation.suggestions.length > 0) {
                    console.log(`[Precipitator] Suggestions: ${validation.suggestions.join('; ')}`);
                }

                if (!validation.valid) {
                    console.log(`[Precipitator] Skill quality too low (${validation.score}/10), saving as knowledge instead`);
                    // Downgrade to knowledge entry if quality is too low
                    return this.saveAsKnowledge(knowledge, experiment, 'concepts');
                }

                // Apply suggestions to improve the skill if score is borderline
                if (validation.score < 7 && validation.suggestions.length > 0) {
                    // Append improvement hints to the skill metadata
                    const improvementNote = `\n\n<!-- Quality Score: ${validation.score}/10. Improvement suggestions: ${validation.suggestions.join('; ')} -->\n`;
                    skill.skillMd += improvementNote;
                }

                return this.installSkill(skill);
            }

            case 'procedure':
                return this.saveAsKnowledge(knowledge, experiment, 'procedures');

            case 'knowledge_entry':
            default:
                return this.saveAsKnowledge(knowledge, experiment, 'concepts');
        }
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createPrecipitator(
    deps: PrecipitatorDependencies,
    config?: Partial<SelfLearningConfig>
): Precipitator {
    return new Precipitator(deps, config);
}

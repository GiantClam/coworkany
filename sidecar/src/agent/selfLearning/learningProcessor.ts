/**
 * CoworkAny - Learning Processor
 *
 * Processes research results into structured, actionable knowledge.
 * Generates test cases and evaluates knowledge quality.
 */

import * as crypto from 'crypto';
import type {
    ResearchResult,
    ProcessedKnowledge,
    KnowledgeType,
    LearningOutcome,
    TestCase,
    CodeExample,
    SelfLearningConfig,
} from './types';
import { DEFAULT_CONFIG } from './types';

// ============================================================================
// Constants
// ============================================================================

const MIN_SOURCES_FOR_HIGH_CONFIDENCE = 3;
const MIN_CODE_EXAMPLES_FOR_SKILL = 2;

// ============================================================================
// Types
// ============================================================================

export interface LearningProcessorDependencies {
    /**
     * Optional: Use LLM to synthesize knowledge
     * If not provided, uses rule-based synthesis
     */
    synthesize?: (prompt: string) => Promise<string>;
}

// ============================================================================
// LearningProcessor Class
// ============================================================================

export class LearningProcessor {
    private config: SelfLearningConfig;
    private deps: LearningProcessorDependencies;

    constructor(
        deps: LearningProcessorDependencies = {},
        config?: Partial<SelfLearningConfig>
    ) {
        this.deps = deps;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ========================================================================
    // Main Processing Method
    // ========================================================================

    /**
     * Process research results into structured knowledge
     */
    async process(research: ResearchResult): Promise<LearningOutcome> {
        // 1. Determine knowledge type based on gap
        const knowledgeType = this.determineKnowledgeType(research);

        // 2. Extract and structure knowledge
        const knowledge = await this.extractKnowledge(research, knowledgeType);

        // 3. Generate test cases
        const testCases = this.generateTestCases(knowledge, research);

        // 4. Determine if skill generation is possible
        const canGenerateSkill = this.canGenerateSkill(knowledge, research);

        // 5. Generate skill name if applicable
        const suggestedSkillName = canGenerateSkill
            ? this.generateSkillName(research.gap.keywords)
            : undefined;

        return {
            knowledge,
            canGenerateSkill,
            suggestedSkillName,
            validationRequired: knowledge.some(k => k.confidence < 0.8),
            estimatedTestCases: testCases,
        };
    }

    // ========================================================================
    // Knowledge Type Determination
    // ========================================================================

    /**
     * Determine the type of knowledge based on research
     */
    private determineKnowledgeType(research: ResearchResult): KnowledgeType {
        const gap = research.gap;

        // Check gap type first
        switch (gap.type) {
            case 'library':
                return 'api_reference';
            case 'procedure':
                return 'procedure';
            case 'tool':
                return research.codeExamples.length > 0 ? 'procedure' : 'concept';
            case 'domain_knowledge':
            default:
                // Analyze content to determine
                const hasSteps = research.sources.some(s =>
                    /step\s*\d|first.*then|1\.\s*|2\.\s*/i.test(s.contentSnippet)
                );
                return hasSteps ? 'procedure' : 'concept';
        }
    }

    // ========================================================================
    // Knowledge Extraction
    // ========================================================================

    /**
     * Extract structured knowledge from research
     */
    private async extractKnowledge(
        research: ResearchResult,
        primaryType: KnowledgeType
    ): Promise<ProcessedKnowledge[]> {
        const knowledge: ProcessedKnowledge[] = [];

        // Create primary knowledge entry
        const primary = await this.createPrimaryKnowledge(research, primaryType);
        knowledge.push(primary);

        // Extract additional knowledge from code examples
        if (research.codeExamples.length > 0) {
            const codeKnowledge = this.extractCodeKnowledge(research);
            if (codeKnowledge) {
                knowledge.push(codeKnowledge);
            }
        }

        // Extract troubleshooting knowledge if relevant
        const troubleshooting = this.extractTroubleshootingKnowledge(research);
        if (troubleshooting) {
            knowledge.push(troubleshooting);
        }

        return knowledge;
    }

    /**
     * Create primary knowledge entry
     */
    private async createPrimaryKnowledge(
        research: ResearchResult,
        type: KnowledgeType
    ): Promise<ProcessedKnowledge> {
        const gap = research.gap;
        const title = this.generateTitle(gap.keywords, type);

        // Use LLM synthesis if available
        let summary: string;
        let detailedContent: string;
        let steps: string[] | undefined;

        if (this.deps.synthesize) {
            const synthesis = await this.synthesizeWithLLM(research, type);
            summary = synthesis.summary;
            detailedContent = synthesis.detailed;
            steps = synthesis.steps;
        } else {
            // Rule-based synthesis
            const synthesis = this.synthesizeRuleBased(research, type);
            summary = synthesis.summary;
            detailedContent = synthesis.detailed;
            steps = synthesis.steps;
        }

        return {
            id: crypto.randomUUID(),
            type,
            title,
            summary,
            detailedContent,
            prerequisites: this.extractPrerequisites(research),
            steps,
            codeTemplate: this.selectBestCodeTemplate(research.codeExamples),
            dependencies: research.dependencies,
            confidence: research.confidence,
            sourceResearch: research,
            createdAt: new Date().toISOString(),
        };
    }

    /**
     * Synthesize knowledge using LLM
     */
    private async synthesizeWithLLM(
        research: ResearchResult,
        type: KnowledgeType
    ): Promise<{ summary: string; detailed: string; steps?: string[] }> {
        const sourceSummaries = research.sources
            .slice(0, 5)
            .map(s => `- ${s.title}: ${s.contentSnippet}`)
            .join('\n');

        const codeExamples = research.codeExamples
            .slice(0, 3)
            .map(e => `\`\`\`${e.language}\n${e.code}\n\`\`\``)
            .join('\n');

        const prompt = `Based on the following research about "${research.gap.keywords.join(', ')}":

Sources:
${sourceSummaries}

Code Examples:
${codeExamples}

Please provide:
1. A concise summary (2-3 sentences)
2. Detailed explanation with key concepts
${type === 'procedure' ? '3. Step-by-step instructions' : ''}

Format your response as JSON:
{
  "summary": "...",
  "detailed": "...",
  "steps": ["step 1", "step 2", ...] // only if procedure
}`;

        try {
            const response = await this.deps.synthesize!(prompt);
            return JSON.parse(response);
        } catch (error) {
            console.warn('[LearningProcessor] LLM synthesis failed, using rule-based:', error);
            return this.synthesizeRuleBased(research, type);
        }
    }

    /**
     * Rule-based synthesis (fallback)
     */
    private synthesizeRuleBased(
        research: ResearchResult,
        type: KnowledgeType
    ): { summary: string; detailed: string; steps?: string[] } {
        const gap = research.gap;
        const topSource = research.sources[0];

        // Generate summary from top source
        const summary = topSource
            ? `${gap.keywords[0]}: ${topSource.contentSnippet.slice(0, 200)}...`
            : `Knowledge about ${gap.keywords.join(', ')}`;

        // Compile detailed content from sources
        const detailed = research.sources
            .slice(0, 3)
            .map(s => `## ${s.title}\n\n${s.contentSnippet}\n\nSource: ${s.url}`)
            .join('\n\n---\n\n');

        // Extract steps if procedure type
        let steps: string[] | undefined;
        if (type === 'procedure') {
            steps = this.extractSteps(research);
        }

        return { summary, detailed, steps };
    }

    /**
     * Extract steps from research sources
     */
    private extractSteps(research: ResearchResult): string[] {
        const steps: string[] = [];

        for (const source of research.sources) {
            const content = source.fullContent || source.contentSnippet;

            // Look for numbered steps
            const numberedPattern = /(?:^|\n)\s*(\d+)[.)]\s*([^\n]+)/g;
            let match;
            while ((match = numberedPattern.exec(content)) !== null) {
                steps.push(match[2].trim());
            }

            // Look for bullet points with action verbs
            const bulletPattern = /(?:^|\n)\s*[-*]\s*((?:Install|Run|Create|Add|Configure|Set|Open|Click|Type|Enter|Select)[^\n]+)/gi;
            while ((match = bulletPattern.exec(content)) !== null) {
                if (!steps.includes(match[1].trim())) {
                    steps.push(match[1].trim());
                }
            }

            if (steps.length >= 5) break;
        }

        return steps.slice(0, 10);
    }

    /**
     * Extract code-specific knowledge
     */
    private extractCodeKnowledge(research: ResearchResult): ProcessedKnowledge | null {
        if (research.codeExamples.length === 0) return null;

        const examples = research.codeExamples;
        const primaryLang = this.detectPrimaryLanguage(examples);

        // Combine code examples
        const codeTemplate = examples
            .filter(e => e.language === primaryLang || e.language === 'unknown')
            .slice(0, 3)
            .map(e => `# ${e.description}\n${e.code}`)
            .join('\n\n');

        return {
            id: crypto.randomUUID(),
            type: 'api_reference',
            title: `Code Examples: ${research.gap.keywords[0]}`,
            summary: `${examples.length} code examples for ${research.gap.keywords.join(', ')}`,
            detailedContent: codeTemplate,
            prerequisites: [],
            codeTemplate,
            dependencies: research.dependencies,
            confidence: Math.min(research.confidence + 0.1, 1.0),
            sourceResearch: research,
            createdAt: new Date().toISOString(),
        };
    }

    /**
     * Extract troubleshooting knowledge
     */
    private extractTroubleshootingKnowledge(research: ResearchResult): ProcessedKnowledge | null {
        const troubleshootingSources = research.sources.filter(
            s => s.sourceType === 'stackoverflow' ||
                /error|issue|problem|fix|solve/i.test(s.contentSnippet)
        );

        if (troubleshootingSources.length === 0) return null;

        const content = troubleshootingSources
            .slice(0, 3)
            .map(s => `### ${s.title}\n\n${s.contentSnippet}\n\nSource: ${s.url}`)
            .join('\n\n');

        return {
            id: crypto.randomUUID(),
            type: 'troubleshooting',
            title: `Troubleshooting: ${research.gap.keywords[0]}`,
            summary: `Common issues and solutions for ${research.gap.keywords.join(', ')}`,
            detailedContent: content,
            prerequisites: [],
            dependencies: [],
            confidence: Math.max(research.confidence - 0.1, 0.4),
            sourceResearch: research,
            createdAt: new Date().toISOString(),
        };
    }

    // ========================================================================
    // Test Case Generation
    // ========================================================================

    /**
     * Generate test cases for knowledge validation
     */
    generateTestCases(
        knowledge: ProcessedKnowledge[],
        research: ResearchResult
    ): TestCase[] {
        const testCases: TestCase[] = [];

        for (const k of knowledge) {
            switch (k.type) {
                case 'procedure':
                    testCases.push(...this.generateProcedureTests(k));
                    break;
                case 'api_reference':
                    testCases.push(...this.generateAPITests(k, research.codeExamples));
                    break;
                case 'concept':
                    testCases.push(...this.generateConceptTests(k));
                    break;
                case 'troubleshooting':
                    // No automatic tests for troubleshooting
                    break;
            }
        }

        return testCases.slice(0, 5);  // Limit to 5 test cases
    }

    /**
     * Generate tests for procedure knowledge
     */
    private generateProcedureTests(knowledge: ProcessedKnowledge): TestCase[] {
        const tests: TestCase[] = [];

        if (knowledge.steps && knowledge.steps.length > 0) {
            // Test first step
            tests.push({
                id: crypto.randomUUID(),
                name: 'First step execution',
                input: knowledge.steps[0],
                expectedBehavior: 'Step completes without error',
            });

            // Test full procedure
            tests.push({
                id: crypto.randomUUID(),
                name: 'Full procedure',
                input: knowledge.steps.join('\n'),
                expectedBehavior: 'All steps complete successfully',
            });
        }

        return tests;
    }

    /**
     * Generate tests for API/code knowledge
     */
    private generateAPITests(
        knowledge: ProcessedKnowledge,
        codeExamples: CodeExample[]
    ): TestCase[] {
        const tests: TestCase[] = [];

        if (knowledge.codeTemplate) {
            tests.push({
                id: crypto.randomUUID(),
                name: 'Code template execution',
                input: knowledge.codeTemplate,
                expectedBehavior: 'Code executes without syntax errors',
                validationScript: this.generateValidationScript(knowledge.codeTemplate),
            });
        }

        // Add tests from code examples
        for (const example of codeExamples.slice(0, 2)) {
            tests.push({
                id: crypto.randomUUID(),
                name: `Example: ${example.description.slice(0, 30)}...`,
                input: example.code,
                expectedBehavior: 'Example executes successfully',
            });
        }

        return tests;
    }

    /**
     * Generate tests for concept knowledge
     */
    private generateConceptTests(knowledge: ProcessedKnowledge): TestCase[] {
        // Concept tests are harder to automate
        // Generate verification prompts instead
        return [{
            id: crypto.randomUUID(),
            name: 'Concept verification',
            input: knowledge.summary,
            expectedBehavior: 'Knowledge can be applied to solve related problems',
        }];
    }

    /**
     * Generate validation script for code
     */
    private generateValidationScript(code: string): string {
        // Detect language and generate appropriate validation
        if (code.includes('import ') && !code.includes('require(')) {
            // Python
            return `try:\n    exec("""${code.replace(/"""/g, "'''")}""")\n    print("SUCCESS")\nexcept Exception as e:\n    print(f"FAILED: {e}")`;
        }

        if (code.includes('require(') || code.includes('import ')) {
            // JavaScript/TypeScript
            return `try {\n    ${code}\n    console.log("SUCCESS");\n} catch(e) {\n    console.log("FAILED:", e.message);\n}`;
        }

        return code;
    }

    // ========================================================================
    // Skill Generation Decision
    // ========================================================================

    /**
     * Determine if knowledge can be converted to a skill
     */
    canGenerateSkill(
        knowledge: ProcessedKnowledge[],
        research: ResearchResult
    ): boolean {
        // Need high confidence
        if (research.confidence < this.config.minConfidenceToSave) {
            return false;
        }

        // Need multiple sources
        if (research.sources.length < MIN_SOURCES_FOR_HIGH_CONFIDENCE) {
            return false;
        }

        // Need code examples for non-concept knowledge
        const hasProcedure = knowledge.some(k => k.type === 'procedure');
        const hasCode = knowledge.some(k => k.type === 'api_reference');

        if (hasProcedure && research.codeExamples.length < MIN_CODE_EXAMPLES_FOR_SKILL) {
            return false;
        }

        return hasProcedure || hasCode;
    }

    /**
     * Generate a skill name from keywords
     */
    private generateSkillName(keywords: string[]): string {
        const primary = keywords[0].toLowerCase().replace(/[^a-z0-9]/g, '-');
        return `auto-${primary}`;
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Generate title for knowledge
     */
    private generateTitle(keywords: string[], type: KnowledgeType): string {
        const primary = keywords[0];
        switch (type) {
            case 'procedure':
                return `How to use ${primary}`;
            case 'api_reference':
                return `${primary} API Reference`;
            case 'troubleshooting':
                return `Troubleshooting ${primary}`;
            case 'concept':
            default:
                return `Understanding ${primary}`;
        }
    }

    /**
     * Extract prerequisites from research
     */
    private extractPrerequisites(research: ResearchResult): string[] {
        const prerequisites: string[] = [];

        // Dependencies are prerequisites
        for (const dep of research.dependencies) {
            prerequisites.push(`Install ${dep}`);
        }

        // Look for prerequisite mentions in sources
        for (const source of research.sources.slice(0, 3)) {
            const content = source.contentSnippet.toLowerCase();
            if (content.includes('prerequisite') || content.includes('before you begin') ||
                content.includes('requirements')) {
                // Extract the sentence
                const match = source.contentSnippet.match(/(?:prerequisite|before you begin|requirements?)[:\s]+([^.]+)/i);
                if (match) {
                    prerequisites.push(match[1].trim());
                }
            }
        }

        return [...new Set(prerequisites)].slice(0, 5);
    }

    /**
     * Select best code template from examples
     */
    private selectBestCodeTemplate(examples: CodeExample[]): string | undefined {
        if (examples.length === 0) return undefined;

        // Prefer examples with more lines (more complete)
        const sorted = [...examples].sort((a, b) => {
            const aLines = a.code.split('\n').length;
            const bLines = b.code.split('\n').length;
            return bLines - aLines;
        });

        // Return the most complete example that's not too long
        for (const example of sorted) {
            if (example.code.length <= 2000) {
                return example.code;
            }
        }

        // Return first if all are too long
        return examples[0].code.slice(0, 2000);
    }

    /**
     * Detect primary language from code examples
     */
    private detectPrimaryLanguage(examples: CodeExample[]): string {
        const counts: Record<string, number> = {};
        for (const example of examples) {
            const lang = example.language.toLowerCase();
            counts[lang] = (counts[lang] || 0) + 1;
        }

        let maxLang = 'unknown';
        let maxCount = 0;
        for (const [lang, count] of Object.entries(counts)) {
            if (count > maxCount && lang !== 'unknown') {
                maxLang = lang;
                maxCount = count;
            }
        }

        return maxLang;
    }

    /**
     * Assess knowledge quality
     */
    assessQuality(knowledge: ProcessedKnowledge): {
        completeness: number;
        accuracy: number;
        actionability: number;
    } {
        // Completeness: based on content length and structure
        const hasSteps = knowledge.steps && knowledge.steps.length > 0;
        const hasCode = !!knowledge.codeTemplate;
        const hasDetail = knowledge.detailedContent.length > 200;

        const completeness = (
            (hasSteps ? 0.3 : 0) +
            (hasCode ? 0.3 : 0) +
            (hasDetail ? 0.2 : 0) +
            (knowledge.prerequisites.length > 0 ? 0.1 : 0) +
            (knowledge.dependencies.length > 0 ? 0.1 : 0)
        );

        // Accuracy: based on source confidence
        const accuracy = knowledge.confidence;

        // Actionability: based on type and content
        const actionability = {
            procedure: 0.9,
            api_reference: 0.8,
            troubleshooting: 0.7,
            concept: 0.5,
        }[knowledge.type];

        return {
            completeness,
            accuracy,
            actionability,
        };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createLearningProcessor(
    deps: LearningProcessorDependencies = {},
    config?: Partial<SelfLearningConfig>
): LearningProcessor {
    return new LearningProcessor(deps, config);
}

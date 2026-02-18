/**
 * CoworkAny - NLU Engine (自然语言理解引擎)
 *
 * 基于现有的 LLM provider 实现意图识别和实体提取
 * - 复用 Claude/OpenAI 等现有连接
 * - 使用 prompt engineering 实现 NLU
 * - 支持上下文管理和对话历史
 */

import type {
    Intent,
    IntentType,
    Entity,
    Context,
    Message,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface NLUConfig {
    provider: 'claude' | 'openai' | 'local';
    model: string;
    temperature: number;
    maxTokens: number;
    contextWindow: number;  // 保留多少条历史消息
}

export const DEFAULT_NLU_CONFIG: NLUConfig = {
    provider: 'claude',
    model: 'claude-3-haiku-20240307',  // 使用快速模型
    temperature: 0.3,  // 低温度保证一致性
    maxTokens: 500,
    contextWindow: 10,
};

export interface LLMProvider {
    /**
     * 调用 LLM 进行推理
     */
    call(messages: Array<{ role: string; content: string }>): Promise<string>;
}

// ============================================================================
// NLU Engine Class
// ============================================================================

export class NLUEngine {
    private config: NLUConfig;
    private llmProvider?: LLMProvider;

    constructor(config?: Partial<NLUConfig>) {
        this.config = { ...DEFAULT_NLU_CONFIG, ...config };
    }

    /**
     * 设置 LLM Provider
     */
    setLLMProvider(provider: LLMProvider): void {
        this.llmProvider = provider;
    }

    // ========================================================================
    // Intent Recognition
    // ========================================================================

    /**
     * 理解用户输入并识别意图
     */
    async understand(input: string, context: Context): Promise<Intent> {
        if (!this.llmProvider) {
            // Fallback: 使用规则based方法
            return this.ruleBasedUnderstand(input);
        }

        try {
            // 使用 LLM 理解意图
            const intent = await this.llmBasedUnderstand(input, context);
            return intent;
        } catch (error) {
            console.error('[NLU] LLM understanding failed, fallback to rule-based:', error);
            return this.ruleBasedUnderstand(input);
        }
    }

    /**
     * 基于 LLM 的意图理解
     */
    private async llmBasedUnderstand(input: string, context: Context): Promise<Intent> {
        // 构建 prompt
        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(input, context);

        // 调用 LLM
        const messages = [
            { role: 'system', content: systemPrompt },
            ...this.getRecentHistory(context, 3).map(m => ({
                role: m.role,
                content: m.content,
            })),
            { role: 'user', content: userPrompt },
        ];

        const response = await this.llmProvider!.call(messages);

        // 解析 LLM 响应
        return this.parseLLMResponse(response, input);
    }

    /**
     * 构建系统 Prompt
     */
    private buildSystemPrompt(): string {
        return `You are a natural language understanding system for a personal assistant called Jarvis.

Your task is to analyze user input and return a structured JSON response with:
1. Intent type (one of: task_create, task_query, task_update, reminder_set, calendar_check, email_check, learn_new, execute_command, question_answer, chitchat)
2. Confidence score (0.0 - 1.0)
3. Extracted entities (dates, times, priorities, etc.)
4. Slot values

**Intent Types:**
- task_create: User wants to create a new task
- task_query: User asks about their tasks
- task_update: User wants to update an existing task
- reminder_set: User wants to set a reminder
- calendar_check: User asks about calendar/schedule
- email_check: User asks about emails
- learn_new: User wants the system to learn something new
- execute_command: User wants to execute a specific command
- question_answer: User asks a general question
- chitchat: Casual conversation

**Entity Types:**
- date: Date references (today, tomorrow, next week, etc.)
- time: Time references (3pm, 15:00, etc.)
- priority: Priority levels (high, medium, low, critical)
- person: Person names
- task_title: Task name or title
- duration: Time duration (30 minutes, 2 hours, etc.)

**Response Format (JSON):**
{
  "intent": "intent_type",
  "confidence": 0.9,
  "entities": [
    { "type": "date", "value": "2024-11-15", "raw": "tomorrow", "confidence": 0.95 }
  ],
  "slots": {
    "task_title": "Review code",
    "priority": "high"
  }
}

IMPORTANT: Return ONLY the JSON object, no additional text.`;
    }

    /**
     * 构建用户 Prompt
     */
    private buildUserPrompt(input: string, context: Context): string {
        let prompt = `Analyze this user input: "${input}"`;

        // 添加上下文信息
        if (context.currentTask) {
            prompt += `\n\nCurrent task in focus: ${context.currentTask}`;
        }

        if (context.currentFocus) {
            prompt += `\n\nCurrent focus: ${context.currentFocus}`;
        }

        // 添加指代解析提示
        if (input.match(/\b(it|that|this|them)\b/i)) {
            const recentEntities = this.getRecentEntities(context);
            if (recentEntities.length > 0) {
                prompt += `\n\nRecent entities for reference resolution:`;
                recentEntities.forEach((entity, index) => {
                    prompt += `\n${index + 1}. ${entity.type}: ${entity.value}`;
                });
            }
        }

        prompt += '\n\nReturn the JSON analysis:';

        return prompt;
    }

    /**
     * 解析 LLM 响应
     */
    private parseLLMResponse(response: string, originalInput: string): Intent {
        try {
            // 提取 JSON（可能包裹在代码块中）
            const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                            response.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const jsonStr = jsonMatch[1] || jsonMatch[0];
            const parsed = JSON.parse(jsonStr);

            // 验证必需字段
            if (!parsed.intent || typeof parsed.confidence !== 'number') {
                throw new Error('Invalid intent format');
            }

            // 转换为 Intent 类型
            const intent: Intent = {
                type: parsed.intent as IntentType,
                confidence: parsed.confidence,
                entities: (parsed.entities || []).map((e: any) => ({
                    type: e.type,
                    value: e.value,
                    raw: e.raw || e.value,
                    confidence: e.confidence || 0.8,
                    position: e.position || [0, 0],
                })),
                slots: parsed.slots || {},
            };

            return intent;
        } catch (error) {
            console.error('[NLU] Failed to parse LLM response:', error);
            console.error('[NLU] Response was:', response);

            // Fallback to rule-based
            return this.ruleBasedUnderstand(originalInput);
        }
    }

    /**
     * 基于规则的意图理解（Fallback）
     */
    private ruleBasedUnderstand(input: string): Intent {
        const lowerInput = input.toLowerCase();

        // Task creation
        if (lowerInput.match(/\b(create|add|new)\s+(task|todo)\b/) ||
            lowerInput.match(/\b(remind me to|need to|should)\b/)) {
            return {
                type: 'task_create',
                confidence: 0.7,
                entities: this.extractEntitiesRule(input),
                slots: {
                    title: input.replace(/create task:?|add task:?|new task:?/i, '').trim(),
                },
            };
        }

        // Task query
        if (lowerInput.match(/\b(what|show|list|view).*(task|todo|do|next)\b/) ||
            lowerInput.match(/\b(my tasks|what should i)\b/)) {
            return {
                type: 'task_query',
                confidence: 0.8,
                entities: [],
                slots: {},
            };
        }

        // Calendar
        if (lowerInput.match(/\b(calendar|schedule|meeting|appointment)\b/)) {
            return {
                type: 'calendar_check',
                confidence: 0.75,
                entities: this.extractEntitiesRule(input),
                slots: {},
            };
        }

        // Email
        if (lowerInput.match(/\b(email|mail|inbox|message)\b/)) {
            return {
                type: 'email_check',
                confidence: 0.75,
                entities: [],
                slots: {},
            };
        }

        // Learning
        if (lowerInput.match(/\b(learn|how to|teach|research)\b/)) {
            return {
                type: 'learn_new',
                confidence: 0.7,
                entities: [],
                slots: { topic: input },
            };
        }

        // Default: question_answer
        return {
            type: 'question_answer',
            confidence: 0.5,
            entities: this.extractEntitiesRule(input),
            slots: { question: input },
        };
    }

    /**
     * 规则based实体提取
     */
    private extractEntitiesRule(text: string): Entity[] {
        const entities: Entity[] = [];

        // Date patterns
        const datePatterns = [
            { pattern: /\btoday\b/i, value: new Date().toISOString().split('T')[0] },
            { pattern: /\btomorrow\b/i, value: this.getTomorrowDate() },
            { pattern: /\bnext week\b/i, value: this.getNextWeekDate() },
            { pattern: /\bmonday|tuesday|wednesday|thursday|friday|saturday|sunday\b/i, value: null },
        ];

        for (const { pattern, value } of datePatterns) {
            const match = text.match(pattern);
            if (match) {
                entities.push({
                    type: 'date',
                    value: value || match[0],
                    raw: match[0],
                    confidence: 0.8,
                    position: [match.index!, match.index! + match[0].length],
                });
            }
        }

        // Time patterns
        const timePattern = /\b(\d{1,2}):?(\d{2})?\s*(am|pm)?\b/i;
        const timeMatch = text.match(timePattern);
        if (timeMatch) {
            entities.push({
                type: 'time',
                value: timeMatch[0],
                raw: timeMatch[0],
                confidence: 0.75,
                position: [timeMatch.index!, timeMatch.index! + timeMatch[0].length],
            });
        }

        // Priority
        const priorityPattern = /\b(critical|urgent|high|medium|low)\s+(priority)?\b/i;
        const priorityMatch = text.match(priorityPattern);
        if (priorityMatch) {
            entities.push({
                type: 'priority',
                value: priorityMatch[1].toLowerCase(),
                raw: priorityMatch[0],
                confidence: 0.9,
                position: [priorityMatch.index!, priorityMatch.index! + priorityMatch[0].length],
            });
        }

        return entities;
    }

    // ========================================================================
    // Context Management
    // ========================================================================

    /**
     * 解析指代（it, that, this等）
     */
    resolveReferences(input: string, context: Context): string {
        let resolved = input;

        // 查找指代词
        const pronouns = ['it', 'that', 'this', 'them', 'those', 'these'];
        const lowerInput = input.toLowerCase();

        for (const pronoun of pronouns) {
            const regex = new RegExp(`\\b${pronoun}\\b`, 'gi');
            if (regex.test(lowerInput)) {
                // 获取最近的实体
                const recentEntity = this.getMostRecentEntity(context);
                if (recentEntity) {
                    resolved = resolved.replace(regex, recentEntity.value);
                    console.log(`[NLU] Resolved "${pronoun}" to "${recentEntity.value}"`);
                }
            }
        }

        return resolved;
    }

    /**
     * 获取最近的实体
     */
    private getMostRecentEntity(context: Context): { type: string; value: string } | null {
        // 从最近的消息中查找实体
        const recentMessages = this.getRecentHistory(context, 3);

        for (let i = recentMessages.length - 1; i >= 0; i--) {
            const msg = recentMessages[i];
            if (msg.metadata?.entities) {
                const entities = msg.metadata.entities as Entity[];
                if (entities.length > 0) {
                    return {
                        type: entities[0].type,
                        value: entities[0].value,
                    };
                }
            }
        }

        // Fallback: 检查 context.referencedEntities
        const entries = [...context.referencedEntities.entries()];
        if (entries.length > 0) {
            const [key, value] = entries[entries.length - 1];
            return { type: 'unknown', value: String(value) };
        }

        return null;
    }

    /**
     * 获取最近的实体列表
     */
    private getRecentEntities(context: Context): Array<{ type: string; value: string }> {
        const entities: Array<{ type: string; value: string }> = [];

        const recentMessages = this.getRecentHistory(context, 5);
        for (const msg of recentMessages) {
            if (msg.metadata?.entities) {
                const msgEntities = msg.metadata.entities as Entity[];
                entities.push(...msgEntities.map(e => ({ type: e.type, value: e.value })));
            }
        }

        // 去重
        return entities.filter((e, index, self) =>
            index === self.findIndex(t => t.type === e.type && t.value === e.value)
        ).slice(-5);
    }

    /**
     * 获取最近的对话历史
     */
    private getRecentHistory(context: Context, count: number): Message[] {
        return context.conversationHistory.slice(-count);
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    private getTomorrowDate(): string {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    }

    private getNextWeekDate(): string {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek.toISOString().split('T')[0];
    }

    /**
     * 获取配置
     */
    getConfig(): NLUConfig {
        return { ...this.config };
    }

    /**
     * 更新配置
     */
    updateConfig(updates: Partial<NLUConfig>): void {
        this.config = { ...this.config, ...updates };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createNLUEngine(config?: Partial<NLUConfig>): NLUEngine {
    return new NLUEngine(config);
}

# UI 架构重构计划 (UI Architecture Refactoring Plan)

## 验证时间
2026-02-10

---

## 🎯 总览 (Overview)

当前项目的 UI/交互界面存在大量不合理和使用异常的地方，影响了可维护性、性能和用户体验。本文档详细分析了所有问题并提供重构方案。

### 核心问题分类
1. **代码结构问题** - 组件过大、逻辑混乱、重复代码
2. **样式管理问题** - 大量内联样式、缺乏主题统一性
3. **性能问题** - 不必要的重渲染、复杂计算未优化
4. **可访问性问题** - 缺少 ARIA 标签、键盘导航支持不足
5. **状态管理问题** - Store 逻辑过于复杂、数据流不清晰

---

## 📊 问题详细分析

### 问题 1: 大量内联样式 (Excessive Inline Styles) 🔴 严重

#### 现状
**受影响文件**:
- `Timeline.tsx` - 50+ 处内联样式
- `SettingsView.tsx` - 100+ 处内联样式
- `ChatInterface.tsx` - 30+ 处内联样式

**示例代码** (Timeline.tsx:194-202):
```tsx
<div className="tool-info" style={{ flex: 1, overflow: 'hidden' }}>
    <span className="tool-icon">🔧</span>
    <strong style={{ marginRight: 8 }}>{item.toolName}</strong>
    {!expanded && preview && (
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {preview}
        </span>
    )}
</div>
```

#### 问题分析
- **维护困难**: 样式分散在 JSX 中，难以统一修改
- **主题切换困难**: 无法通过 CSS 变量统一管理
- **性能损耗**: 每次渲染都创建新的 style 对象
- **代码可读性差**: JSX 充斥样式代码，逻辑不清晰

#### 重构方案

**方案 A: CSS Modules (推荐)** ✅
```tsx
// Timeline.module.css
.toolInfo {
    flex: 1;
    overflow: hidden;
}

.toolPreview {
    font-size: 12px;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
}

// Timeline.tsx
import styles from './Timeline.module.css';

<div className={styles.toolInfo}>
    <span className="tool-icon">🔧</span>
    <strong className={styles.toolName}>{item.toolName}</strong>
    {!expanded && preview && (
        <span className={styles.toolPreview}>{preview}</span>
    )}
</div>
```

**优势**:
- 样式隔离，避免全局污染
- 支持 TypeScript 自动补全
- 编译时优化，生成哈希类名

**方案 B: Tailwind CSS (备选)**
- 更快的开发速度
- 需要引入新依赖
- 学习成本

**推荐**: 使用 CSS Modules，符合现有架构，渐进式重构

---

### 问题 2: 组件过于庞大 (Monolithic Components) 🔴 严重

#### 现状

**SettingsView.tsx - 538 行**
- 包含 LLM 配置、Profile 管理、Search 设置
- 所有逻辑混在一个文件
- 难以测试、难以复用

**Timeline.tsx - 400 行**
- 包含事件归约逻辑 (135 行)
- 多个子组件 (ToolCard, MessageBubble, SystemBadge)
- 文本处理工具函数

**useTaskEventStore.ts - 630 行**
- 包含 10+ 种事件处理逻辑
- 事件归约函数 275 行
- 持久化逻辑、选择器

#### 重构方案

**SettingsView.tsx 拆分**:
```
Settings/
├── SettingsView.tsx (主容器，100行)
├── components/
│   ├── ProfileEditor.tsx (配置编辑表单)
│   ├── ProfileList.tsx (Profile 列表)
│   ├── SearchSettings.tsx (搜索配置)
│   └── DirectivesSection.tsx (指令编辑)
├── hooks/
│   └── useSettings.ts (配置加载/保存逻辑)
└── Settings.module.css
```

**新的 SettingsView.tsx**:
```tsx
export function SettingsView() {
    const { config, loading, error, saved, refresh, saveConfig } = useSettings();

    return (
        <div className={styles.container}>
            <SettingsHeader onRefresh={refresh} loading={loading} />
            {error && <ErrorBanner message={error} />}
            {saved && <SuccessBanner message="Settings updated." />}

            <DirectivesSection />
            <ProfileEditor config={config} onSave={saveConfig} />
            <ProfileList config={config} onSwitch={switchProfile} />
            <SearchSettings settings={config.search} onSave={saveSearchSettings} />
        </div>
    );
}
```

**Timeline.tsx 拆分**:
```
Chat/Timeline/
├── Timeline.tsx (主组件，100行)
├── components/
│   ├── ToolCard.tsx
│   ├── MessageBubble.tsx
│   └── SystemBadge.tsx
├── hooks/
│   └── useTimelineItems.ts (事件归约逻辑)
├── utils/
│   └── messageProcessor.ts (文本处理)
└── Timeline.module.css
```

**useTaskEventStore 拆分**:
```
stores/
├── useTaskEventStore.ts (主 Store，100行)
├── taskEvents/
│   ├── eventReducer.ts (事件归约逻辑)
│   ├── persistence.ts (持久化)
│   ├── selectors.ts (选择器)
│   └── types.ts (类型定义)
```

---

### 问题 3: 事件归约逻辑在组件中 (Event Reduction in Component) 🟡 中等

#### 现状

**Timeline.tsx `useTimelineItems` hook (lines 25-159)**:
```tsx
function useTimelineItems(session: TaskSession): TimelineItemType[] {
    return useMemo(() => {
        const items: TimelineItemType[] = [];
        const toolMap = new Map<string, TimelineItemType & { type: 'tool_call' }>();
        const effectMap = new Map<string, TimelineItemType & { type: 'effect_request' }>();
        const patchMap = new Map<string, TimelineItemType & { type: 'patch' }>();

        let currentDraftId: string | null = null;

        for (const event of session.events) {
            // ... 130 行事件处理逻辑
        }
        return items;
    }, [session.events]);
}
```

#### 问题分析
- **135 行逻辑**在组件文件中
- 难以单元测试（需要模拟整个组件环境）
- 难以复用（其他组件可能需要类似的事件归约）
- 与 UI 渲染逻辑混在一起

#### 重构方案

**新建文件**: `src/lib/events/timelineReducer.ts`
```typescript
export function reduceToTimelineItems(events: TaskEvent[]): TimelineItemType[] {
    const items: TimelineItemType[] = [];
    const toolMap = new Map<string, ToolCallItem>();
    const effectMap = new Map<string, EffectRequestItem>();
    const patchMap = new Map<string, PatchItem>();

    let currentDraftId: string | null = null;

    for (const event of events) {
        const item = reduceEvent(event, { toolMap, effectMap, patchMap, currentDraftId });
        if (item) items.push(item);
    }

    return items;
}

function reduceEvent(
    event: TaskEvent,
    context: ReductionContext
): TimelineItemType | null {
    switch (event.type) {
        case 'CHAT_MESSAGE': return reduceChatMessage(event);
        case 'TOOL_CALLED': return reduceToolCall(event, context);
        case 'TEXT_DELTA': return reduceTextDelta(event, context);
        // ... 按类型拆分
    }
}
```

**测试文件**: `src/lib/events/__tests__/timelineReducer.test.ts`
```typescript
describe('reduceToTimelineItems', () => {
    it('should reduce CHAT_MESSAGE events', () => {
        const events = [
            { type: 'CHAT_MESSAGE', payload: { role: 'user', content: 'Hello' } }
        ];
        const items = reduceToTimelineItems(events);
        expect(items).toHaveLength(1);
        expect(items[0].type).toBe('user_message');
    });

    it('should handle TEXT_DELTA streaming', () => {
        // 独立测试流式文本逻辑
    });
});
```

**Timeline.tsx 简化后**:
```tsx
import { reduceToTimelineItems } from '../../lib/events/timelineReducer';

export const Timeline: React.FC<{ session: TaskSession }> = ({ session }) => {
    const items = useMemo(() => reduceToTimelineItems(session.events), [session.events]);

    return (
        <div className={styles.timeline} ref={containerRef}>
            {items.map(renderTimelineItem)}
            <div ref={endRef} />
        </div>
    );
};
```

---

### 问题 4: 文本处理未优化 (Unoptimized Text Processing) 🟡 中等

#### 现状

**Timeline.tsx `processMessageContent` (lines 263-283)**:
```tsx
const processMessageContent = (text: string): string => {
    let processed = text;

    // 1. Remove Emojis (每次渲染都执行复杂正则)
    processed = processed.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}...]/gu, '');

    // 2. Compact Markdown
    processed = processed.replace(/\*\* +(.+?) +\*\*/g, '**$1**');
    processed = processed.replace(/(?<!\*)\* +(.+?) +\*(?!\*)/g, '*$1*');
    processed = processed.replace(/` +(.+?) +`/g, '`$1`');

    // 3. Clean Newlines
    processed = processed.replace(/[\r\n]{3,}/g, '\n\n');

    return processed.trim();
};
```

**使用位置** (line 315):
```tsx
<ReactMarkdown>
    {processMessageContent(item.content)}
</ReactMarkdown>
```

#### 问题分析
- **每次渲染都执行**复杂的正则替换
- **未 memoize**，即使内容未变化
- **性能损耗**：每个消息气泡渲染都重新处理
- **不可配置**：无法关闭某些处理步骤

#### 重构方案

**方案 A: useMemo 优化** (快速修复)
```tsx
const MessageBubble: React.FC<Props> = ({ item, isUser }) => {
    const processedContent = useMemo(
        () => isUser ? item.content : processMessageContent(item.content),
        [item.content, isUser]
    );

    return (
        <div className={styles.bubble}>
            {isUser ? (
                <div className={styles.userMessage}>{processedContent}</div>
            ) : (
                <ReactMarkdown>{processedContent}</ReactMarkdown>
            )}
        </div>
    );
};
```

**方案 B: 预处理 + 缓存** (推荐)
```typescript
// src/lib/text/messageProcessor.ts
import LRU from 'lru-cache';

const processCache = new LRU<string, string>({ max: 500 });

export function processMessageContent(text: string, options?: ProcessOptions): string {
    const cacheKey = `${text}:${JSON.stringify(options)}`;

    if (processCache.has(cacheKey)) {
        return processCache.get(cacheKey)!;
    }

    let processed = text;

    if (options?.removeEmojis ?? true) {
        processed = removeEmojis(processed);
    }

    if (options?.compactMarkdown ?? true) {
        processed = compactMarkdown(processed);
    }

    if (options?.cleanNewlines ?? true) {
        processed = cleanNewlines(processed);
    }

    processed = processed.trim();
    processCache.set(cacheKey, processed);

    return processed;
}

// 拆分为独立函数，便于测试
function removeEmojis(text: string): string {
    return text.replace(/[\u{1F600}-\u{1F64F}...]/gu, '');
}

function compactMarkdown(text: string): string {
    return text
        .replace(/\*\* +(.+?) +\*\*/g, '**$1**')
        .replace(/(?<!\*)\* +(.+?) +\*(?!\*)/g, '*$1*')
        .replace(/` +(.+?) +`/g, '`$1`');
}

function cleanNewlines(text: string): string {
    return text.replace(/[\r\n]{3,}/g, '\n\n');
}
```

**配置支持**:
```tsx
// 用户可在设置中禁用某些处理
const MessageBubble = ({ item, isUser, processingOptions }) => {
    const content = useMemo(
        () => isUser ? item.content : processMessageContent(item.content, processingOptions),
        [item.content, isUser, processingOptions]
    );
    // ...
};
```

---

### 问题 5: 类型定义重复 (Duplicated Type Definitions) 🟡 中等

#### 现状

**Timeline.tsx (lines 13-19)**:
```tsx
type TimelineItemType =
    | { type: 'user_message'; id: string; content: string; timestamp: string }
    | { type: 'assistant_message'; id: string; content: string; timestamp: string; isStreaming?: boolean }
    | { type: 'tool_call'; id: string; toolName: string; args: any; status: 'running' | 'success' | 'failed'; result?: string; timestamp: string }
    | { type: 'system_event'; id: string; content: string; timestamp: string }
    | { type: 'effect_request'; id: string; effectType: string; risk: number; approved?: boolean; timestamp: string }
    | { type: 'patch'; id: string; filePath: string; status: 'proposed' | 'applied' | 'rejected'; timestamp: string };
```

**useTaskEventStore.ts (lines 18-67)**:
```typescript
export interface TaskEvent {
    id: string;
    taskId: string;
    timestamp: string;
    sequence: number;
    type: string;
    payload: Record<string, unknown>;
}

export interface PlanStep { ... }
export interface ToolCall { ... }
export interface Effect { ... }
export interface Patch { ... }
export interface ChatMessage { ... }
```

#### 问题分析
- **类型分散**在多个文件
- **无统一类型定义**，容易不一致
- **难以维护**：修改事件结构需要多处修改

#### 重构方案

**新建文件**: `src/types/events.ts`
```typescript
// ============================================================================
// Base Event Types
// ============================================================================

export interface BaseEvent {
    id: string;
    timestamp: string;
}

export interface TaskEvent extends BaseEvent {
    taskId: string;
    sequence: number;
    type: TaskEventType;
    payload: TaskEventPayload;
}

export type TaskEventType =
    | 'TASK_STARTED'
    | 'TASK_FINISHED'
    | 'TASK_FAILED'
    | 'CHAT_MESSAGE'
    | 'TOOL_CALLED'
    | 'TOOL_RESULT'
    | 'TEXT_DELTA'
    | 'EFFECT_REQUESTED'
    | 'EFFECT_APPROVED'
    | 'EFFECT_DENIED'
    | 'PATCH_PROPOSED'
    | 'PATCH_APPLIED'
    | 'PATCH_REJECTED';

export type TaskEventPayload =
    | TaskStartedPayload
    | ChatMessagePayload
    | ToolCalledPayload
    | TextDeltaPayload
    | EffectRequestedPayload
    | PatchProposedPayload;

// ============================================================================
// Timeline Item Types (UI表示)
// ============================================================================

export type TimelineItemType =
    | UserMessageItem
    | AssistantMessageItem
    | ToolCallItem
    | SystemEventItem
    | EffectRequestItem
    | PatchItem;

export interface UserMessageItem extends BaseEvent {
    type: 'user_message';
    content: string;
}

export interface AssistantMessageItem extends BaseEvent {
    type: 'assistant_message';
    content: string;
    isStreaming?: boolean;
}

export interface ToolCallItem extends BaseEvent {
    type: 'tool_call';
    toolName: string;
    args: Record<string, unknown>;
    status: ToolCallStatus;
    result?: string;
}

export type ToolCallStatus = 'running' | 'success' | 'failed';

// ... 其他类型
```

**导入使用**:
```typescript
// Timeline.tsx
import type { TimelineItemType, ToolCallItem } from '../../types/events';

// useTaskEventStore.ts
import type { TaskEvent, TaskEventType } from '../../types/events';
```

---

### 问题 6: Store 逻辑过于复杂 (Overly Complex Store Logic) 🔴 严重

#### 现状

**useTaskEventStore.ts**:
- 630 行单文件
- `applyEvent` 函数 275 行
- 10+ 种 switch case
- 持久化、缓存、选择器混在一起

**问题片段** (lines 179-454):
```typescript
function applyEvent(session: TaskSession, event: TaskEvent): TaskSession {
    // 275 行的巨大 switch 语句
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'TASK_STARTED': /* 30 lines */
        case 'PLAN_UPDATED': /* 15 lines */
        case 'TASK_FINISHED': /* 20 lines */
        case 'TASK_FAILED': /* 20 lines */
        case 'TASK_STATUS': /* 25 lines */
        case 'TASK_HISTORY_CLEARED': /* 20 lines */
        case 'CHAT_MESSAGE': /* 25 lines */
        case 'TOOL_CALLED': /* 30 lines */
        case 'EFFECT_REQUESTED': /* 35 lines */
        case 'EFFECT_APPROVED': /* 30 lines */
        case 'PATCH_PROPOSED': /* 30 lines */
        case 'TEXT_DELTA': /* 40 lines */
        default: return updated;
    }
}
```

#### 重构方案

**新目录结构**:
```
stores/taskEvents/
├── index.ts (主 Store，100行)
├── reducers/
│   ├── taskReducer.ts (TASK_* 事件)
│   ├── chatReducer.ts (CHAT_*, TEXT_DELTA)
│   ├── toolReducer.ts (TOOL_*)
│   ├── effectReducer.ts (EFFECT_*)
│   └── patchReducer.ts (PATCH_*)
├── persistence.ts (持久化逻辑)
├── selectors.ts (选择器)
└── types.ts (类型)
```

**reducers/taskReducer.ts**:
```typescript
import type { TaskSession, TaskEvent } from '../../types/events';

export function applyTaskEvent(
    session: TaskSession,
    event: TaskEvent
): TaskSession {
    switch (event.type) {
        case 'TASK_STARTED':
            return applyTaskStarted(session, event);
        case 'TASK_FINISHED':
            return applyTaskFinished(session, event);
        case 'TASK_FAILED':
            return applyTaskFailed(session, event);
        case 'TASK_STATUS':
            return applyTaskStatus(session, event);
        default:
            return session;
    }
}

function applyTaskStarted(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as TaskStartedPayload;
    return {
        ...session,
        status: 'running',
        title: payload.title,
        workspacePath: payload.context?.workspacePath,
        messages: [
            ...session.messages,
            {
                id: event.id,
                role: 'user',
                content: payload.context?.userQuery ?? payload.description ?? '',
                timestamp: event.timestamp,
            },
        ],
        events: [...session.events, event],
        updatedAt: new Date().toISOString(),
    };
}

// ... 其他 task 事件处理
```

**stores/taskEvents/index.ts** (简化后):
```typescript
import { create } from 'zustand';
import { applyTaskEvent } from './reducers/taskReducer';
import { applyChatEvent } from './reducers/chatReducer';
import { applyToolEvent } from './reducers/toolReducer';
import { applyEffectEvent } from './reducers/effectReducer';
import { applyPatchEvent } from './reducers/patchReducer';
import { schedulePersist } from './persistence';

function applyEvent(session: TaskSession, event: TaskEvent): TaskSession {
    // 防止重复事件
    if (session.events.some(e => e.id === event.id)) {
        return session;
    }

    // 路由到具体的 reducer
    let updated = session;
    updated = applyTaskEvent(updated, event);
    updated = applyChatEvent(updated, event);
    updated = applyToolEvent(updated, event);
    updated = applyEffectEvent(updated, event);
    updated = applyPatchEvent(updated, event);

    return updated;
}

export const useTaskEventStore = create<TaskEventStoreState>((set, get) => ({
    sessions: new Map(),
    activeTaskId: null,

    addEvent: (event: TaskEvent) => {
        set((state) => {
            const sessions = new Map(state.sessions);
            const existing = sessions.get(event.taskId) ?? createEmptySession(event.taskId);
            const updated = applyEvent(existing, event);
            sessions.set(event.taskId, updated);

            schedulePersist({ sessions: Array.from(sessions.values()), activeTaskId: state.activeTaskId });

            return { sessions };
        });
    },

    // ... 其他 actions
}));
```

**测试文件结构**:
```
__tests__/
├── taskReducer.test.ts
├── chatReducer.test.ts
├── toolReducer.test.ts
├── effectReducer.test.ts
├── patchReducer.test.ts
└── persistence.test.ts
```

---

### 问题 7: 缺少可访问性支持 (Missing Accessibility) 🟡 中等

#### 现状

**示例 1: 工具卡片无 ARIA 标签** (Timeline.tsx:191-208)
```tsx
<div className="timeline-item tool-call">
    <div className={`tool-card ${displayStatus}`}>
        <div className="tool-header" onClick={() => setExpanded(!expanded)}>
            {/* 无 aria-label, aria-expanded, role */}
            <div className="tool-info" style={{ flex: 1, overflow: 'hidden' }}>
                <span className="tool-icon">🔧</span>
                <strong>{item.toolName}</strong>
            </div>
        </div>
    </div>
</div>
```

**示例 2: SettingsView 表单无标签关联**
```tsx
<input
    type="text"
    value={editName}
    onChange={(e) => setEditName(e.target.value)}
    placeholder="e.g. My Claude 3.5"
    // 无 id, aria-labelledby
/>
```

#### 问题分析
- **屏幕阅读器**无法正确识别元素
- **键盘导航**不完整
- **焦点管理**缺失（模态框、下拉菜单）
- **不符合 WCAG 2.1 标准**

#### 重构方案

**ToolCard 增加可访问性**:
```tsx
const ToolCard: React.FC<{ item: ToolCallItem }> = ({ item }) => {
    const [expanded, setExpanded] = useState(false);
    const headerId = useId();
    const contentId = useId();

    return (
        <div className={styles.toolCallItem} role="article" aria-labelledby={headerId}>
            <div className={styles.toolCard} data-status={item.status}>
                <button
                    className={styles.toolHeader}
                    onClick={() => setExpanded(!expanded)}
                    aria-expanded={expanded}
                    aria-controls={contentId}
                    id={headerId}
                >
                    <div className={styles.toolInfo}>
                        <span className={styles.toolIcon} aria-hidden="true">🔧</span>
                        <span className={styles.toolName}>{item.toolName}</span>
                        {!expanded && preview && (
                            <span className={styles.toolPreview} aria-label="Preview">
                                {preview}
                            </span>
                        )}
                    </div>
                    <div className={styles.toolStatus}>
                        <span className={styles.statusDot} data-status={item.status} aria-hidden="true" />
                        <span>{item.status.toUpperCase()}</span>
                    </div>
                </button>
                {expanded && (
                    <div
                        className={styles.toolBody}
                        id={contentId}
                        role="region"
                        aria-labelledby={headerId}
                    >
                        {/* ... */}
                    </div>
                )}
            </div>
        </div>
    );
};
```

**SettingsView 表单增强**:
```tsx
function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
    return (
        <div className={styles.field}>
            <label htmlFor={id} className={styles.label}>
                {label}
            </label>
            {children}
        </div>
    );
}

// 使用
<Field label="Profile Name" id="profile-name">
    <input
        id="profile-name"
        type="text"
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        placeholder="e.g. My Claude 3.5"
        aria-describedby="profile-name-hint"
    />
    <span id="profile-name-hint" className={styles.hint}>
        Enter a descriptive name for this profile
    </span>
</Field>
```

**键盘导航支持**:
```tsx
// ChatInterface - 添加快捷键支持
useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
        // Cmd/Ctrl + Enter 发送消息
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSend();
        }

        // Escape 关闭模态框
        if (e.key === 'Escape') {
            if (showSkillsModal) setShowSkillsModal(false);
            if (showMcpModal) setShowMcpModal(false);
        }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
}, [showSkillsModal, showMcpModal]);
```

**焦点管理**:
```tsx
// ModalDialog 增强
export const ModalDialog: React.FC<ModalDialogProps> = ({ open, onClose, title, children }) => {
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (open) {
            // 模态框打开时聚焦关闭按钮
            closeButtonRef.current?.focus();
        }
    }, [open]);

    return (
        <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className={styles.overlay} />
                <Dialog.Content
                    className={styles.content}
                    onOpenAutoFocus={(e) => {
                        e.preventDefault();
                        closeButtonRef.current?.focus();
                    }}
                    aria-describedby={undefined} // 防止警告
                >
                    <div className={styles.header}>
                        <Dialog.Title className={styles.title}>{title}</Dialog.Title>
                        <button
                            ref={closeButtonRef}
                            className={styles.closeBtn}
                            onClick={onClose}
                            aria-label="Close dialog"
                        >
                            <X size={15} />
                        </button>
                    </div>
                    <div className={styles.body} role="document">
                        {children}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
```

---

### 问题 8: CSS 架构混乱 (Chaotic CSS Architecture) 🟡 中等

#### 现状

**当前 CSS 文件分布**:
```
src/
├── index.css (全局重置)
├── styles/
│   ├── global.css (全局样式)
│   └── variables.css (CSS 变量)
├── components/
│   ├── Chat/
│   │   ├── ChatInterface.css (组件样式)
│   │   └── Timeline/Timeline.css
│   ├── Settings/SettingsView.tsx (无 CSS，全内联)
│   └── Common/ModalDialog.css
```

**问题**:
- **命名不一致**: `.tool-card`, `.modal-dialog-overlay`, `.skill-manager`
- **样式分散**: 部分组件有 CSS 文件，部分全内联
- **无统一规范**: 有的用 BEM，有的随意命名
- **CSS 变量使用不一致**: 有的用 `var(--text-muted)`，有的硬编码颜色

#### 重构方案

**统一 CSS Modules 架构**:
```
src/
├── styles/
│   ├── variables.css (CSS 变量定义)
│   ├── global.css (全局样式)
│   ├── reset.css (CSS 重置)
│   └── utilities.css (工具类)
├── components/
│   ├── Chat/
│   │   ├── ChatInterface.tsx
│   │   ├── ChatInterface.module.css
│   │   └── Timeline/
│   │       ├── Timeline.tsx
│   │       ├── Timeline.module.css
│   │       ├── components/
│   │       │   ├── ToolCard.tsx
│   │       │   └── ToolCard.module.css
│   ├── Settings/
│   │   ├── SettingsView.tsx
│   │   ├── SettingsView.module.css
│   │   └── components/
│   │       ├── ProfileEditor.tsx
│   │       └── ProfileEditor.module.css
```

**CSS 变量规范** (`styles/variables.css`):
```css
:root {
    /* ========== Colors ========== */
    /* Text */
    --text-primary: hsl(0, 0%, 10%);
    --text-secondary: hsl(0, 0%, 30%);
    --text-muted: hsl(0, 0%, 50%);
    --text-disabled: hsl(0, 0%, 70%);

    /* Background */
    --bg-primary: hsl(0, 0%, 100%);
    --bg-secondary: hsl(0, 0%, 98%);
    --bg-tertiary: hsl(0, 0%, 95%);
    --bg-subtle: hsl(0, 0%, 97%);

    /* Borders */
    --border-primary: hsl(0, 0%, 85%);
    --border-subtle: hsl(0, 0%, 92%);

    /* Accent */
    --accent-primary: hsl(210, 100%, 50%);
    --accent-hover: hsl(210, 100%, 45%);
    --accent-active: hsl(210, 100%, 40%);

    /* Status */
    --status-success: hsl(120, 60%, 45%);
    --status-warning: hsl(40, 100%, 50%);
    --status-error: hsl(0, 70%, 50%);
    --status-info: hsl(210, 80%, 55%);

    /* ========== Spacing ========== */
    --space-1: 0.25rem;  /* 4px */
    --space-2: 0.5rem;   /* 8px */
    --space-3: 0.75rem;  /* 12px */
    --space-4: 1rem;     /* 16px */
    --space-6: 1.5rem;   /* 24px */
    --space-8: 2rem;     /* 32px */

    /* ========== Border Radius ========== */
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-xl: 16px;

    /* ========== Shadows ========== */
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
    --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.15);

    /* ========== Typography ========== */
    --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --font-mono: "SF Mono", Monaco, "Cascadia Code", "Courier New", monospace;

    --font-size-xs: 0.75rem;   /* 12px */
    --font-size-sm: 0.875rem;  /* 14px */
    --font-size-base: 1rem;    /* 16px */
    --font-size-lg: 1.125rem;  /* 18px */
    --font-size-xl: 1.25rem;   /* 20px */

    /* ========== Transitions ========== */
    --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
    --transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1);
    --transition-slow: 350ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Dark Theme */
[data-theme="dark"] {
    --text-primary: hsl(0, 0%, 95%);
    --text-secondary: hsl(0, 0%, 75%);
    --text-muted: hsl(0, 0%, 55%);
    --text-disabled: hsl(0, 0%, 35%);

    --bg-primary: hsl(0, 0%, 10%);
    --bg-secondary: hsl(0, 0%, 13%);
    --bg-tertiary: hsl(0, 0%, 16%);
    --bg-subtle: hsl(0, 0%, 12%);

    --border-primary: hsl(0, 0%, 25%);
    --border-subtle: hsl(0, 0%, 18%);
}
```

**组件 CSS 示例** (`Timeline.module.css`):
```css
.timeline {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    overflow-y: auto;
    height: 100%;
}

.timelineItem {
    animation: fadeIn var(--transition-base);
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

/* User Message */
.userMessage {
    align-self: flex-end;
    max-width: 70%;
}

.userMessage .contentBubble {
    background: var(--accent-primary);
    color: white;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    white-space: pre-wrap;
}

/* Assistant Message */
.assistantMessage {
    align-self: flex-start;
    max-width: 85%;
}

.assistantMessage .contentBubble {
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
}

/* Tool Call Card */
.toolCard {
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    overflow: hidden;
    transition: box-shadow var(--transition-base);
}

.toolCard:hover {
    box-shadow: var(--shadow-md);
}

.toolCard[data-status="success"] {
    border-left: 3px solid var(--status-success);
}

.toolCard[data-status="failed"] {
    border-left: 3px solid var(--status-error);
}

.toolHeader {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    background: none;
    border: none;
    width: 100%;
    text-align: left;
}

.toolHeader:hover {
    background: var(--bg-tertiary);
}

.toolInfo {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    overflow: hidden;
}

.toolName {
    font-weight: 600;
    color: var(--text-primary);
}

.toolPreview {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
}
```

**命名规范**:
- **组件类名**: camelCase (`.toolCard`, `.userMessage`)
- **状态类名**: data 属性 (`data-status="success"`, `data-expanded="true"`)
- **工具类**: kebab-case (`.flex-center`, `.text-muted`) - 仅用于 utilities.css

---

### 问题 9: 性能优化缺失 (Missing Performance Optimizations) 🟡 中等

#### 现状

**未使用 React.memo**:
```tsx
// ToolCard 每次父组件重渲染都会重渲染
const ToolCard: React.FC<{ item: ToolCallItem }> = ({ item }) => {
    // ...
};
```

**未使用 useCallback**:
```tsx
// Timeline.tsx - 每次渲染都创建新函数
{items.map((item) => {
    switch (item.type) {
        case 'tool_call':
            return <ToolCard key={item.id} item={item as any} />;
        // ...
    }
})}
```

**大列表未虚拟化**:
- Timeline 可能有 100+ 条消息
- Settings 中的 Profile 列表
- 无虚拟滚动，全部渲染

#### 重构方案

**React.memo 优化**:
```tsx
export const ToolCard = React.memo<ToolCardProps>(({ item, onExpand }) => {
    const [expanded, setExpanded] = useState(false);
    // ...
    return <div className={styles.toolCard}>...</div>;
}, (prevProps, nextProps) => {
    // 自定义比较逻辑
    return (
        prevProps.item.id === nextProps.item.id &&
        prevProps.item.status === nextProps.item.status &&
        prevProps.item.result === nextProps.item.result
    );
});

ToolCard.displayName = 'ToolCard';
```

**useCallback 优化**:
```tsx
export const Timeline: React.FC<{ session: TaskSession }> = ({ session }) => {
    const items = useTimelineItems(session);

    const renderTimelineItem = useCallback((item: TimelineItemType) => {
        switch (item.type) {
            case 'user_message':
                return <MessageBubble key={item.id} item={item} isUser={true} />;
            case 'assistant_message':
                return <MessageBubble key={item.id} item={item} isUser={false} />;
            case 'tool_call':
                return <ToolCard key={item.id} item={item} />;
            case 'system_event':
                return <SystemBadge key={item.id} content={item.content} />;
            default:
                return null;
        }
    }, []);

    return (
        <div className={styles.timeline} ref={containerRef}>
            {items.map(renderTimelineItem)}
            <div ref={endRef} />
        </div>
    );
};
```

**虚拟滚动 (react-window)**:
```tsx
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

export const Timeline: React.FC<{ session: TaskSession }> = ({ session }) => {
    const items = useTimelineItems(session);

    const Row = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
        const item = items[index];
        return (
            <div style={style}>
                {renderTimelineItem(item)}
            </div>
        );
    }, [items]);

    return (
        <AutoSizer>
            {({ height, width }) => (
                <List
                    height={height}
                    itemCount={items.length}
                    itemSize={120} // 根据实际内容动态调整
                    width={width}
                    overscanCount={5}
                >
                    {Row}
                </List>
            )}
        </AutoSizer>
    );
};
```

**State 更新优化**:
```tsx
// useTaskEventStore.ts - 使用 immer 简化不可变更新
import { produce } from 'immer';

export const useTaskEventStore = create<TaskEventStoreState>((set, get) => ({
    sessions: new Map(),

    addEvent: (event: TaskEvent) => {
        set(produce((draft) => {
            const existing = draft.sessions.get(event.taskId) ?? createEmptySession(event.taskId);
            const updated = applyEvent(existing, event);
            draft.sessions.set(event.taskId, updated);
        }));
    },
}));
```

---

### 问题 10: 数据获取逻辑在 Store 中 (Data Fetching in Store) 🟡 中等

#### 现状

**useWorkspaceStore.ts**:
- IPC 调用直接在 store actions 中
- 错误处理、加载状态混在一起
- 难以测试、难以复用

```typescript
loadWorkspaces: async () => {
    set({ isLoading: true, error: null });
    try {
        const result = await invoke<IpcResult>('list_workspaces');
        // ... 复杂的数据处理
        set({ workspaces: list });
    } catch (err) {
        set({ error: message });
    } finally {
        set({ isLoading: false });
    }
},
```

#### 重构方案

**分离数据层**:
```
src/
├── api/
│   ├── workspaces.ts (IPC 调用封装)
│   ├── tasks.ts
│   └── settings.ts
├── hooks/
│   ├── useWorkspaces.ts (React Query / SWR)
│   └── useTasks.ts
├── stores/
│   └── useUIStore.ts (仅 UI 状态)
```

**api/workspaces.ts**:
```typescript
import { invoke } from '@tauri-apps/api/core';

export async function fetchWorkspaces(): Promise<Workspace[]> {
    const result = await invoke<IpcResult>('list_workspaces');
    if (!result.success || !result.payload) {
        throw new Error('Failed to fetch workspaces');
    }

    const data = typeof result.payload === 'string'
        ? JSON.parse(result.payload)
        : result.payload;

    return data.payload?.workspaces || [];
}

export async function createWorkspace(input: { name: string; path: string }): Promise<Workspace> {
    const result = await invoke<IpcResult>('create_workspace', { input });
    if (!result.success || !result.payload) {
        throw new Error('Failed to create workspace');
    }

    const data = typeof result.payload === 'string'
        ? JSON.parse(result.payload)
        : result.payload;

    const workspace = data.payload?.workspace;
    if (!workspace) {
        throw new Error('Invalid response: missing workspace data');
    }

    return workspace;
}

export async function updateWorkspace(id: string, updates: Partial<Workspace>): Promise<void> {
    const result = await invoke<IpcResult>('update_workspace', { input: { id, updates } });
    if (!result.success) {
        throw new Error('Failed to update workspace');
    }
}

export async function deleteWorkspace(id: string): Promise<void> {
    const result = await invoke<IpcResult>('delete_workspace', { input: { id } });
    if (!result.success) {
        throw new Error('Failed to delete workspace');
    }
}
```

**hooks/useWorkspaces.ts (使用 TanStack Query)**:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as workspacesApi from '../api/workspaces';

export function useWorkspaces() {
    const queryClient = useQueryClient();

    const { data: workspaces = [], isLoading, error } = useQuery({
        queryKey: ['workspaces'],
        queryFn: workspacesApi.fetchWorkspaces,
        staleTime: 5 * 60 * 1000, // 5 分钟
    });

    const createMutation = useMutation({
        mutationFn: workspacesApi.createWorkspace,
        onSuccess: (newWorkspace) => {
            queryClient.setQueryData<Workspace[]>(['workspaces'], (old = []) => [...old, newWorkspace]);
            // 自动选择新workspace
            selectWorkspace(newWorkspace);
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, updates }: { id: string; updates: Partial<Workspace> }) =>
            workspacesApi.updateWorkspace(id, updates),
        onSuccess: (_, { id, updates }) => {
            queryClient.setQueryData<Workspace[]>(['workspaces'], (old = []) =>
                old.map(w => (w.id === id ? { ...w, ...updates } : w))
            );
        },
    });

    const deleteMutation = useMutation({
        mutationFn: workspacesApi.deleteWorkspace,
        onSuccess: (_, deletedId) => {
            queryClient.setQueryData<Workspace[]>(['workspaces'], (old = []) =>
                old.filter(w => w.id !== deletedId)
            );
        },
    });

    return {
        workspaces,
        isLoading,
        error: error ? String(error) : null,
        createWorkspace: createMutation.mutate,
        updateWorkspace: (id: string, updates: Partial<Workspace>) =>
            updateMutation.mutate({ id, updates }),
        deleteWorkspace: deleteMutation.mutate,
    };
}

function useActiveWorkspace() {
    const { workspaces } = useWorkspaces();
    const activeId = localStorage.getItem('activeWorkspaceId');

    const activeWorkspace = useMemo(
        () => workspaces.find(w => w.id === activeId) ?? workspaces[0] ?? null,
        [workspaces, activeId]
    );

    const selectWorkspace = useCallback((workspace: Workspace | null) => {
        if (workspace) {
            localStorage.setItem('activeWorkspaceId', workspace.id);
        } else {
            localStorage.removeItem('activeWorkspaceId');
        }
        // 触发重新计算
        window.dispatchEvent(new Event('storage'));
    }, []);

    return { activeWorkspace, selectWorkspace };
}
```

**组件使用**:
```tsx
export function WorkspaceSelector() {
    const { workspaces, isLoading, createWorkspace, deleteWorkspace } = useWorkspaces();
    const { activeWorkspace, selectWorkspace } = useActiveWorkspace();

    if (isLoading) return <div>Loading...</div>;

    return (
        <div className={styles.selector}>
            <select
                value={activeWorkspace?.id ?? ''}
                onChange={(e) => {
                    const selected = workspaces.find(w => w.id === e.target.value);
                    selectWorkspace(selected ?? null);
                }}
            >
                {workspaces.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                ))}
            </select>

            <button onClick={() => createWorkspace({ name: 'New Workspace', path: '/path' })}>
                Add
            </button>
        </div>
    );
}
```

**优势**:
- ✅ 自动缓存、自动重新验证
- ✅ 乐观更新支持
- ✅ 错误重试、离线支持
- ✅ DevTools 调试
- ✅ 易于测试

---

## 🛠️ 实施计划

### Phase 1: 基础重构 (Week 1-2)

**优先级 P0** - 立即开始

1. **CSS Modules 迁移**
   - 创建 CSS 变量规范文件
   - 迁移 Timeline.tsx 到 CSS Modules
   - 迁移 SettingsView.tsx 到 CSS Modules
   - 创建组件 CSS 模板

2. **类型定义统一**
   - 创建 `src/types/events.ts`
   - 创建 `src/types/ui.ts`
   - 更新所有导入

3. **文本处理优化**
   - 提取 `processMessageContent` 到 `src/lib/text/messageProcessor.ts`
   - 添加 LRU 缓存
   - 添加单元测试

**验收标准**:
- ✅ 所有组件使用 CSS Modules
- ✅ 无内联样式 (除特殊动态值)
- ✅ 类型定义集中管理
- ✅ 文本处理性能提升 50%+

---

### Phase 2: 组件拆分 (Week 3-4)

**优先级 P1**

1. **SettingsView 拆分**
   ```
   Settings/
   ├── SettingsView.tsx (100行)
   ├── components/
   │   ├── ProfileEditor.tsx
   │   ├── ProfileList.tsx
   │   └── SearchSettings.tsx
   ├── hooks/
   │   └── useSettings.ts
   ```

2. **Timeline 拆分**
   ```
   Chat/Timeline/
   ├── Timeline.tsx (100行)
   ├── components/
   │   ├── ToolCard.tsx
   │   ├── MessageBubble.tsx
   │   └── SystemBadge.tsx
   ├── hooks/
   │   └── useTimelineItems.ts
   ├── utils/
   │   └── messageProcessor.ts
   ```

3. **ChatInterface 拆分**
   ```
   Chat/
   ├── ChatInterface.tsx (150行)
   ├── components/
   │   ├── InputArea.tsx
   │   ├── Header.tsx
   │   └── Modals/
   │       ├── SkillsModal.tsx
   │       └── McpModal.tsx
   ```

**验收标准**:
- ✅ 单文件不超过 200 行
- ✅ 每个组件职责单一
- ✅ 所有组件有单元测试

---

### Phase 3: Store 重构 (Week 5-6)

**优先级 P1**

1. **useTaskEventStore 拆分**
   ```
   stores/taskEvents/
   ├── index.ts (100行)
   ├── reducers/
   │   ├── taskReducer.ts
   │   ├── chatReducer.ts
   │   ├── toolReducer.ts
   │   ├── effectReducer.ts
   │   └── patchReducer.ts
   ├── persistence.ts
   ├── selectors.ts
   └── __tests__/
   ```

2. **数据获取分离**
   ```
   api/
   ├── workspaces.ts
   ├── tasks.ts
   └── settings.ts

   hooks/
   ├── useWorkspaces.ts
   └── useTasks.ts
   ```

3. **引入 TanStack Query**
   - 安装依赖: `@tanstack/react-query`
   - 配置 QueryClient
   - 迁移数据获取逻辑

**验收标准**:
- ✅ Store 只管理 UI 状态
- ✅ 数据获取逻辑在 hooks/api
- ✅ 缓存、错误处理统一
- ✅ 所有 reducer 有单元测试

---

### Phase 4: 性能优化 (Week 7)

**优先级 P2**

1. **React.memo 优化**
   - ToolCard
   - MessageBubble
   - ProfileCard

2. **虚拟滚动**
   - Timeline (100+ 消息)
   - 使用 react-window

3. **代码分割**
   - 路由懒加载
   - 动态导入大组件

**验收标准**:
- ✅ React DevTools Profiler 无不必要渲染
- ✅ Timeline 滚动帧率 60fps
- ✅ 首屏加载时间 < 2s

---

### Phase 5: 可访问性增强 (Week 8)

**优先级 P2**

1. **ARIA 标签**
   - 所有交互元素添加 aria-label
   - 表单关联 label
   - 焦点管理

2. **键盘导航**
   - Tab 顺序正确
   - 快捷键支持
   - Escape 关闭模态框

3. **测试**
   - 安装 @axe-core/react
   - 自动化可访问性测试

**验收标准**:
- ✅ WCAG 2.1 AA 级别合规
- ✅ 屏幕阅读器测试通过
- ✅ 键盘导航完整

---

### Phase 6: 测试覆盖 (Week 9-10)

**优先级 P2**

1. **单元测试**
   - Reducers (90%+ 覆盖率)
   - Hooks (80%+ 覆盖率)
   - Utils (90%+ 覆盖率)

2. **集成测试**
   - 用户流程测试
   - 使用 Testing Library

3. **E2E 测试**
   - 关键路径测试
   - 使用 Playwright

**验收标准**:
- ✅ 总覆盖率 > 70%
- ✅ 关键路径 E2E 测试
- ✅ CI/CD 集成

---

## 📈 预期收益

### 代码质量提升
- ✅ **可维护性**: 单文件平均行数从 400+ 降至 150
- ✅ **可测试性**: 测试覆盖率从 0% 提升至 70%+
- ✅ **可读性**: 逻辑分层清晰，职责分明

### 性能提升
- ✅ **首屏加载**: 减少 30%
- ✅ **渲染性能**: Timeline 滚动帧率稳定 60fps
- ✅ **内存占用**: 减少 20% (虚拟滚动)

### 用户体验提升
- ✅ **可访问性**: WCAG 2.1 AA 合规
- ✅ **主题支持**: 统一 CSS 变量，易于切换主题
- ✅ **响应速度**: 数据缓存，减少重复请求

### 开发体验提升
- ✅ **开发效率**: 组件复用，减少重复代码
- ✅ **调试效率**: React Query DevTools, Zustand DevTools
- ✅ **协作效率**: 代码规范统一，易于 Code Review

---

## 🚨 风险与应对

### 风险 1: 重构过程中功能回归

**应对**:
- 每个 Phase 完成后完整回归测试
- 保留原代码备份（git tag）
- 渐进式重构，不一次性大改

### 风险 2: 引入新依赖导致包体积增大

**应对**:
- 使用 Bundle Analyzer 监控
- 仅引入必要依赖 (react-window, @tanstack/react-query)
- Tree-shaking 优化

### 风险 3: 团队学习成本

**应对**:
- 提供详细文档和示例
- 代码 Review 时知识分享
- 创建组件开发模板

---

## 📚 相关资源

### 学习资料
- [CSS Modules Documentation](https://github.com/css-modules/css-modules)
- [TanStack Query Guide](https://tanstack.com/query/latest)
- [React Performance Optimization](https://react.dev/reference/react/memo)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)

### 工具推荐
- **Bundle Analyzer**: `vite-plugin-bundle-visualizer`
- **Accessibility Testing**: `@axe-core/react`, `eslint-plugin-jsx-a11y`
- **Performance Profiling**: React DevTools Profiler
- **State Management DevTools**: Zustand DevTools, React Query DevTools

---

## ✅ 总结

当前 UI 架构存在 **10 个主要问题**，影响了代码质量、性能和用户体验。通过 **6 个阶段** 的系统性重构，我们将：

1. **消除内联样式**，统一 CSS Modules 架构
2. **拆分大组件**，提升可维护性和可测试性
3. **优化事件归约逻辑**，分离业务逻辑和 UI
4. **重构 Store**，分离数据获取和状态管理
5. **性能优化**，虚拟滚动 + React.memo
6. **可访问性增强**，WCAG 2.1 AA 合规

预计 **10 周** 完成全部重构，带来 **显著的代码质量和性能提升**。

---

*生成时间: 2026-02-10*
*报告版本: 1.0*

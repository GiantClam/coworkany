# Workflow AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Workflow Canvas 中接入一个可展开/隐藏的 AI 侧栏，让 AI 通过受限工具创建、修改、校验和运行工作流，并使用 AI Elements 组件显示消息、工具调用、审批和 operation group 状态。

**Architecture:** Workflow Core 提供纯函数 command/transaction 层，所有节点、端口、配置和控制结构操作均经现有 registry/schema/validator。`@coworkany/workbench-ui` 提供 AI Elements 组合式侧栏和业务适配组件；Desktop 负责把当前 workflow revision、Provider capability 和 AI SDK UIMessage stream 接到现有本地 Host，并把 operation group 持久化到 Tauri SQLite。侧栏是 Workflow Workspace 的兄弟布局区域，不放进 React Flow `Panel`，因此展开时画布让出空间、隐藏时画布恢复全宽。

**Tech Stack:** TypeScript, React 19-compatible shared UI, AI SDK `UIMessage`/`ChatTransport`, existing `@coworkany/workflow-core`, existing `@coworkany/workbench-client`, AI Elements registry source, Tauri Rust/SQLite, `tsx --test`, React server-render tests.

## Global Constraints

- 所有已配置且当前可用的 Provider 都是 AI 候选；不得修改凭证、账号配置、租户权限或系统开关。
- AI 可执行 Workflow Core 支持的全部合法工作流/节点操作，包括新增、删除、复制、重命名、参数/Provider/Model、连线、分组、输入输出、批量、条件、有限循环、布局和校验。
- 每条用户消息最多产生一个 `operationGroup`；撤销/重做以 operation group 为单位，回滚生成新 revision。
- AI 默认不运行工作流；运行/测试必须由用户明确要求，并经过 preflight、Provider/Credits/费用检查和必要确认。
- 第一版只支持带最大迭代次数、超时、取消、持久化和恢复的有限循环；禁止无限或无界回边。
- 不开放任意 JSON patch、任意代码、任意 URL、凭证写入或直接数据库写入给模型。
- 聊天基础 UI 优先复用 `packages/workbench-ui/src/ai-elements`；不得继续扩展 `components/ai-entry/prompt-kit/*` 形成第二套 primitive。
- 不引入 `ai-elements` 黑盒运行时包；使用可审查、可定制的 registry/source 组件，并保留现有 Workbench tokens、ARIA 和宿主回调。
- 侧栏必须可展开、隐藏、恢复历史和调整宽度；展开不覆盖节点。

---

### Task 1: 固化 Workflow AI command 与 operation group 契约

**Files:**
- Create: `packages/workflow-core/src/ai-operations.ts`
- Modify: `packages/workflow-core/src/index.ts`
- Test: `packages/workflow-core/test/ai-operations.test.ts`
- Reference: `packages/workflow-core/src/definition.ts`, `packages/workflow-core/src/connect.ts`, `packages/workflow-core/src/node-definitions/registry.ts`

**Interfaces:**
- Consumes: `WorkflowDefinitionEnvelope`, `WorkflowNodeDefinitionV2`, `workflowNodeRegistry`, `validateWorkflowDefinition`, `areWorkflowPortsCompatible`.
- Produces:
  ```ts
  export type WorkflowAiCommand =
    | { type: "add_node"; node: WorkflowDefinitionNodeV2 }
    | { type: "update_node"; nodeKey: string; patch: Partial<WorkflowDefinitionNodeV2> }
    | { type: "copy_node"; sourceNodeKey: string; node: WorkflowDefinitionNodeV2 }
    | { type: "delete_node"; nodeKey: string }
    | { type: "connect_nodes"; edge: WorkflowDefinitionEdgeV2 }
    | { type: "disconnect_nodes"; edgeKey: string }
    | { type: "update_port_mapping"; nodeKey: string; portId: string; value: unknown }
    | { type: "group_nodes"; nodeKeys: string[]; groupNode: WorkflowDefinitionNodeV2 }
    | { type: "ungroup_nodes"; nodeKey: string }
    | { type: "create_control_structure"; node: WorkflowDefinitionNodeV2 }
    | { type: "layout_nodes"; nodeKeys: string[]; positions: Record<string, { x: number; y: number }> };

  export type WorkflowAiOperationGroup = {
    id: string; conversationId: string; workflowId: string; baseRevision: number;
    resultRevision: number | null; commands: readonly WorkflowAiCommand[];
    status: "applied" | "rolled_back" | "failed"; summary: string; createdAt: string;
  };

  export function applyWorkflowAiCommands(input: {
    definition: WorkflowDefinitionEnvelope; baseRevision: number;
    commands: readonly WorkflowAiCommand[];
  }): { definition: WorkflowDefinitionEnvelope; changedNodeKeys: readonly string[] };
  ```

- [ ] **Step 1: Write failing tests** for adding/updating/deleting/copying nodes, connecting/disconnecting valid edges, rejecting unknown node types and ports, rejecting incompatible ports, preserving unrelated nodes, and rejecting `baseRevision` mismatch.
- [ ] **Step 2: Run the focused test**

Run: `pnpm exec tsx --test packages/workflow-core/test/ai-operations.test.ts`

Expected: FAIL because the command reducer and exported types do not exist.

- [ ] **Step 3: Implement the pure reducer**. Resolve every node through `workflowNodeRegistry`, allocate no provider credentials, validate each intermediate graph, canonicalize/hash the final definition, and throw typed errors `{ code: "workflow_ai_revision_conflict" | "workflow_ai_invalid_command" | "workflow_ai_validation_failed"; details }`.
- [ ] **Step 4: Run focused and existing Workflow Core tests**

Run: `pnpm exec tsx --test packages/workflow-core/test/ai-operations.test.ts packages/workflow-core/test/definition.test.ts packages/workflow-core/test/connect.test.ts`

Expected: PASS with no change to existing validation behavior.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-core/src/ai-operations.ts packages/workflow-core/src/index.ts packages/workflow-core/test/ai-operations.test.ts
git commit -m "Define workflow AI operation transactions"
```

### Task 2: Add typed client contracts for workflow AI streams and approvals

**Files:**
- Create: `packages/workbench-client/src/workflow-ai.ts`
- Modify: `packages/workbench-client/src/index.ts`
- Modify: `packages/workbench-client/src/uimessage.ts`
- Test: `packages/workbench-client/test/workflow-ai.test.ts`
- Reference: `packages/workbench-client/src/message-parts.ts`, `packages/workbench-client/src/uimessage.ts`

**Interfaces:**
- Consumes: `WorkflowAiOperationGroup`, `WorkflowAiCommand`, existing `DesktopUIMessage`, `WorkbenchRunEvent`, and `DesktopChatTransport`.
- Produces:
  ```ts
  export type WorkflowAiContext = {
    workflowId: string; revision: number; definition: WorkflowDefinitionEnvelope;
    selectedNodeKeys: readonly string[]; validationIssues: readonly WorkflowValidationIssue[];
    configuredProviders: readonly WorkflowAiProviderOption[]; viewport?: { x: number; y: number; scale: number };
  };
  export type WorkflowAiProviderOption = { id: string; label: string; models: readonly string[]; capabilities: readonly string[]; available: boolean; estimatedCost?: number };
  export type WorkflowAiToolDecision = { toolCallId: string; operationGroupId: string; decision: "approve" | "reject" };
  export function createWorkflowAiPrompt(context: WorkflowAiContext, userText: string): string;
  export function isWorkflowAiToolName(value: string): boolean;
  export function workflowAiContextToMetadata(context: WorkflowAiContext): Record<string, unknown>;
  ```

- [ ] **Step 1: Write failing tests** for context serialization without credentials/local paths, provider list retaining every configured available provider, operation-group/tool-event normalization, and approval decision round-tripping.
- [ ] **Step 2: Run the focused test**

Run: `pnpm exec tsx --test packages/workbench-client/test/workflow-ai.test.ts`

Expected: FAIL because the workflow AI adapter does not exist.

- [ ] **Step 3: Implement the adapter** using the existing AI SDK UIMessage dynamic-tool shape. Map workflow tool phases to `input-available`, `approval-requested`, `output-available`, `output-error`, and `output-denied`; never serialize API keys, base URLs with embedded credentials, local file paths, or arbitrary node payloads into the prompt metadata.
- [ ] **Step 4: Run client tests and existing UIMessage tests**

Run: `pnpm --filter @coworkany/workbench-client test`

Expected: PASS, including all existing stream de-duplication and approval tests.

- [ ] **Step 5: Commit**

```bash
git add packages/workbench-client/src/workflow-ai.ts packages/workbench-client/src/index.ts packages/workbench-client/src/uimessage.ts packages/workbench-client/test/workflow-ai.test.ts
git commit -m "Add typed workflow AI message contracts"
```

### Task 3: Persist operation groups with optimistic revision checks

**Files:**
- Modify: `apps/desktop/src-tauri/src/storage.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/workbench-client.ts`
- Test: `apps/desktop/src-tauri/src/storage.rs` (Rust unit tests)
- Test: `apps/desktop/test/workflow-ai-storage.test.ts`

**Interfaces:**
- Consumes: `WorkflowAiOperationGroup`, sanitized `WorkflowDefinitionEnvelope`, and the existing `workflow_revisions` table.
- Produces Tauri commands and client methods:
  ```ts
  workflows.applyAiOperation(input: {
    workflowId: string; expectedRevision: number; definition: WorkflowDefinitionEnvelope;
    operationGroup: WorkflowAiOperationGroup;
  }): Promise<WorkbenchWorkflow>;
  workflows.operationGroups(workflowId: string): Promise<readonly WorkflowAiOperationGroup[]>;
  ```

- [ ] **Step 1: Write failing persistence tests** for one operation group creating one revision, rejecting stale `expectedRevision` without overwriting the current definition, persisting rolled-back groups, and deleting operation groups with their workflow.
- [ ] **Step 2: Run the focused tests**

Run: `pnpm --filter @coworkany/workbench-client test -- workflow-ai-storage.test.ts` and `cd apps/desktop/src-tauri && cargo test storage::tests::workflow_ai -- --nocapture`

Expected: FAIL because the table/commands/client methods do not exist.

- [ ] **Step 3: Add the SQLite table and transactional command**. Add `workflow_ai_operation_groups` with unique `(workflow_id, id)`, JSON commands/summary, base/result revisions, status, and timestamps. In one transaction, compare the latest revision to `expectedRevision`, insert the new revision and operation group, and return a typed conflict error; use existing redaction and canonical hash functions.
- [ ] **Step 4: Register Tauri commands and map them in `workbench-client.ts`** without exposing raw SQL or credentials to the renderer.
- [ ] **Step 5: Run storage, client, and existing Desktop tests**

Run: `cd apps/desktop/src-tauri && cargo test` and `pnpm --filter @coworkany/workbench-client test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/storage.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/workbench-client.ts apps/desktop/test/workflow-ai-storage.test.ts
git commit -m "Persist workflow AI operation groups"
```

### Task 4: Build the reusable AI Elements workflow sidebar

**Files:**
- Create: `packages/workbench-ui/src/workflow-ai-sidebar.tsx`
- Modify: `packages/workbench-ui/src/index.ts`
- Modify: `packages/workbench-ui/src/styles.css`
- Test: `packages/workbench-ui/test/workflow-ai-sidebar.test.tsx`
- Reference: `packages/workbench-ui/src/workbench-message-surface.tsx`, `packages/workbench-ui/src/process-parts.tsx`, `packages/workbench-ui/src/ai-elements/index.ts`

**Interfaces:**
- Consumes: `DesktopUIMessage[]`, `WorkflowAiContext`, `WorkflowAiOperationGroup[]`, `ModelOption[]`, and typed callbacks.
- Produces:
  ```ts
  export type WorkflowAiSidebarProps = {
    open: boolean; width: number; minWidth?: number; maxWidth?: number;
    messages: readonly DesktopUIMessage[]; operationGroups: readonly WorkflowAiOperationGroup[];
    providerOptions: readonly ModelOption[]; context: WorkflowAiContext; locale: "zh" | "en";
    status: "ready" | "streaming" | "error"; input: string;
    onOpenChange(open: boolean): void; onWidthChange(width: number): void;
    onInputChange(value: string): void; onSubmit(text: string): void | Promise<void>;
    onStop(): void; onRetry(message: DesktopUIMessage): void | Promise<void>;
    onApprove(toolCallId: string): void | Promise<void>; onReject(toolCallId: string): void | Promise<void>;
    onUndoOperationGroup(id: string): void | Promise<void>; onFocusNodes(nodeKeys: readonly string[]): void;
  };
  ```

- [ ] **Step 1: Write failing render tests** for hidden/visible states, no node-overlay markup, `Conversation`/`Message`/`MessageResponse`, `PromptInput`, `Tool`/`Confirmation`, operation-group summary actions, provider selector, and keyboard/ARIA labels.
- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @coworkany/workbench-ui test -- workflow-ai-sidebar.test.tsx`

Expected: FAIL because the sidebar does not exist.

- [ ] **Step 3: Implement the sidebar with existing AI Elements exports**. Use `Conversation` + `Message` for transcript, `Tool` + `Confirmation` for dynamic tool parts, `Task`/`Plan` for operation-group progress, `PromptInput` + `Attachments` for input, `ModelSelector` for configured Provider/Model display, and `Suggestions` for the blank-canvas quick starts. Keep `Reasoning` limited to server-supplied phase summaries; never render raw chain-of-thought. Use a sibling `<aside>` and a CSS grid/flex shell contract, not `Canvas`/`Panel` overlays.
- [ ] **Step 4: Add responsive/resizable styles** with `320px` minimum, `360-420px` desktop default, approximately `88vw` narrow-screen drawer, stable controls, and a hidden state that removes the sidebar track. Add the `streamdown` Tailwind source directive if the current build requires it for `MessageResponse` styles.
- [ ] **Step 5: Run UI tests and typecheck**

Run: `pnpm --filter @coworkany/workbench-ui test` and `pnpm --filter @coworkany/workbench-ui typecheck`

Expected: PASS with existing AI Elements tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/workbench-ui/src/workflow-ai-sidebar.tsx packages/workbench-ui/src/index.ts packages/workbench-ui/src/styles.css packages/workbench-ui/test/workflow-ai-sidebar.test.tsx
git commit -m "Add reusable workflow AI sidebar"
```

### Task 5: Add Desktop workflow AI controller and restricted tool execution

**Files:**
- Create: `apps/desktop/src/workflow-ai-controller.ts`
- Modify: `apps/desktop/src/workbench-client.ts`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/test/workflow-ai-controller.test.ts`
- Reference: `apps/desktop/src/provider-config.ts`, `apps/desktop/src/workflow-provider-binding.ts`, `apps/desktop/src/use-desktop-chat.ts`

**Interfaces:**
- Consumes: `WorkflowAiContext`, `WorkflowAiCommand`, `applyWorkflowAiCommands`, existing `createDesktopChatTransport`, configured provider profiles, and current local definition callbacks.
- Produces:
  ```ts
  export type WorkflowAiController = {
    readonly messages: readonly DesktopUIMessage[];
    readonly operationGroups: readonly WorkflowAiOperationGroup[];
    readonly send: (text: string) => Promise<void>;
    readonly approve: (toolCallId: string) => Promise<void>;
    readonly reject: (toolCallId: string) => Promise<void>;
    readonly undo: (operationGroupId: string) => Promise<void>;
    readonly focus: (nodeKeys: readonly string[]) => void;
  };
  export function createWorkflowAiController(input: {
    workflowId: string; definition: WorkflowDefinitionEnvelope;
    selectedNodeKeys: readonly string[]; providers: readonly DesktopProviderConfig[];
    onDefinitionChange(definition: WorkflowDefinitionEnvelope): void;
    onFocusNodes(nodeKeys: readonly string[]): void;
    client: WorkbenchClient;
  }): WorkflowAiController;
  ```

- [ ] **Step 1: Write failing controller tests** for prompt context inclusion, all configured available providers appearing in the selector context, low-risk edits applying one operation group, high-cost Provider switch/execute/delete returning approval, automatic validation after mutation, stale revision conflict, and explicit-run-only behavior.
- [ ] **Step 2: Run the focused test**

Run: `pnpm exec tsx --test apps/desktop/test/workflow-ai-controller.test.ts`

Expected: FAIL because the controller and tool dispatcher do not exist.

- [ ] **Step 3: Implement the restricted dispatcher**. Accept only named workflow tools; call `applyWorkflowAiCommands`, then `validateWorkflowDefinition`, then `workflows.applyAiOperation`. Resolve Provider candidates from `configuredProviderEntries(config)` and `supportsProviderCapability`, preserving all usable configured entries. Require confirmation for cost increase, unavailable-provider fallback, budget risk, run, or destructive batch delete; never mutate `DesktopConfig` credentials.
- [ ] **Step 4: Connect the controller to the existing Desktop ChatTransport**. Include sanitized workflow context in each prompt, map stream tool parts into `DesktopUIMessage`, persist messages through existing conversation storage, and expose approval callbacks to `Confirmation`.
- [ ] **Step 5: Integrate `WorkflowAiSidebar` into `DesktopWorkflowWorkspace`**. Add `aiSidebarOpen`, `aiSidebarWidth`, unread state, and `onFocusNodes`; render a sibling grid column so the canvas width changes when open. Keep the existing left node palette and right workflow metadata panel independent. Reopen must preserve messages and operation groups.
- [ ] **Step 6: Run Desktop focused tests and typecheck**

Run: `pnpm exec tsx --test apps/desktop/test/workflow-ai-controller.test.ts apps/desktop/test/routes.test.ts` and `pnpm desktop:typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/workflow-ai-controller.ts apps/desktop/src/workbench-client.ts apps/desktop/src/App.tsx apps/desktop/test/workflow-ai-controller.test.ts
git commit -m "Connect workflow canvas to AI operations"
```

### Task 6: Add operation-group undo/redo, node focus, and bounded run preflight

**Files:**
- Modify: `packages/workflow-core/src/ai-operations.ts`
- Modify: `packages/workbench-client/src/workflow-ai.ts`
- Modify: `apps/desktop/src/workflow-ai-controller.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `packages/workbench-ui/src/workflow-ai-sidebar.tsx`
- Test: `packages/workflow-core/test/ai-operations.test.ts`
- Test: `apps/desktop/test/workflow-ai-controller.test.ts`

**Interfaces:**
- Consumes: persisted operation groups and current `DesktopWorkflowWorkspace` history callbacks.
- Produces: `undoWorkflowAiOperationGroup(id)`, `redoWorkflowAiOperationGroup(id)`, `focusWorkflowNodes(nodeKeys)`, and `runWorkflowAiPreflight(definition, providers)`.

- [ ] **Step 1: Write failing tests** for undo/redo creating new revisions, focus selecting/centering nodes without changing the definition, preflight rejecting missing required config/provider/ports, and finite loop definitions requiring positive maximum iterations, timeout, and cancellation support.
- [ ] **Step 2: Run the focused tests**

Run: `pnpm exec tsx --test packages/workflow-core/test/ai-operations.test.ts apps/desktop/test/workflow-ai-controller.test.ts`

Expected: FAIL until operation-group restore and preflight are implemented.

- [ ] **Step 3: Implement restore as a new revision**. Load the target group’s base/result snapshots, apply the inverse through the same validator, persist a new `rolled_back`/`applied` group, and update the local canvas history. Do not delete audit history.
- [ ] **Step 4: Implement focus and preflight**. Focus only changes selection/viewport state; preflight reports required fields, invalid edges, Provider availability, estimated usage/cost, and loop bounds. `run_workflow` is unreachable unless the current user message explicitly requests run/test and the preflight confirmation succeeds.
- [ ] **Step 5: Run all impacted tests**

Run: `pnpm --filter @coworkany/workbench-ui test && pnpm --filter @coworkany/workbench-client test && pnpm exec tsx --test packages/workflow-core/test/*.test.ts apps/desktop/test/workflow-ai-controller.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/workflow-core/src/ai-operations.ts packages/workbench-client/src/workflow-ai.ts apps/desktop/src/workflow-ai-controller.ts apps/desktop/src/App.tsx packages/workbench-ui/src/workflow-ai-sidebar.tsx packages/workflow-core/test/ai-operations.test.ts apps/desktop/test/workflow-ai-controller.test.ts
git commit -m "Add reversible workflow AI preflight"
```

### Task 7: Verify responsive behavior, security boundaries, and migration cleanup

**Files:**
- Modify: `packages/workbench-ui/src/styles.css`
- Modify: `apps/desktop/src/styles.css`
- Modify: `packages/workbench-ui/README.md`
- Test: `packages/workbench-ui/test/workflow-ai-sidebar.test.tsx`
- Test: `apps/desktop/test/workflow-ai-controller.test.ts`
- Test: `packages/workbench-client/test/workflow-ai.test.ts`

- [ ] **Step 1: Add regression tests** that assert the sidebar is absent from the canvas DOM when hidden, has no fixed overlay positioning over the canvas, keeps the same conversation after reopen, excludes provider credentials/local paths from serialized context, rejects arbitrary tool names/URLs/code, and maps approval states to the AI Elements confirmation component.
- [ ] **Step 2: Run static and package verification**

Run: `git diff --check && pnpm --filter @coworkany/workbench-ui typecheck && pnpm --filter @coworkany/workbench-ui test && pnpm --filter @coworkany/workbench-client test && pnpm desktop:typecheck && pnpm lint`

Expected: all commands PASS; no new dependency is added unless the existing version audit proves it is required.

- [ ] **Step 3: Run the desktop smoke test** with a blank workflow and a configured local Provider: open/close AI sidebar, create a three-node workflow, edit a node, request a Provider switch, reject a run approval, reopen the sidebar, undo one operation group, and verify the canvas/operation history remain consistent.
- [ ] **Step 4: Remove only duplicated page-local prompt-kit usage introduced by this feature**. Keep compatibility exports needed by existing non-workflow surfaces; do not delete unrelated user changes.
- [ ] **Step 5: Commit**

```bash
git add packages/workbench-ui/src/styles.css apps/desktop/src/styles.css packages/workbench-ui/README.md packages/workbench-ui/test/workflow-ai-sidebar.test.tsx apps/desktop/test/workflow-ai-controller.test.ts packages/workbench-client/test/workflow-ai.test.ts
git commit -m "Verify workflow AI sidebar boundaries"
```

## Self-Review

- Spec coverage: Tasks 1-2 cover registry/schema/tool contracts; Task 3 covers revisions and audit persistence; Task 4 covers AI Elements composition and expandable sidebar; Task 5 covers all legal operations, Provider selection, approvals, and Desktop integration; Task 6 covers undo/redo, focus, preflight, and finite loops; Task 7 covers responsive, security, migration, and verification.
- No placeholders: all tasks name exact files, interfaces, tests, commands, and expected outcomes.
- Type consistency: `WorkflowAiCommand`, `WorkflowAiOperationGroup`, `WorkflowAiContext`, `WorkflowAiController`, and `WorkflowAiSidebarProps` are introduced before consumers and use existing `WorkflowDefinitionEnvelope`/`DesktopUIMessage` types.
- Known implementation risk: AI SDK/AI Elements upstream examples may target a different major version than this repository. Task 2 explicitly keeps the adapter at the existing `ai` version boundary; do not mechanically upgrade the SDK during implementation.

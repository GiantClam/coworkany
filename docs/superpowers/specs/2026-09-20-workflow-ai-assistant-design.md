# Workflow AI 对话助手设计规格

**日期**：2026-09-20  
**状态**：设计已获用户确认，待规格审阅后进入实施计划  
**范围**：在现有 Workflow Canvas 中增加 AI 对话窗口，帮助用户创建、理解、修改、校验和运行工作流。

## 1. 目标与原则

AI 助手应成为工作流画布中的协作者：用户先用自然语言描述目标，AI 创建可运行的工作流；之后用户继续通过对话增量修改当前画布。AI 的所有画布变更即时生效，但每轮变更都必须可追踪、可整组撤销和重做。

AI 只能通过受限的工作流编辑工具修改定义。工具必须复用现有 Workflow Core 的节点注册表、端口契约、参数 schema、图校验和版本化存储，不能绕过现有运行时、租户、权限、Credits、资产和审计边界。

“完整操作”指 Workflow Core 支持的合法操作，包括新增、删除、复制、重命名和配置节点，创建、删除和重连边，修改端口映射，创建分组/子流程、输入输出、批量和条件/循环结构，以及布局、校验和修复。不包括任意代码执行、任意 HTTP 请求、直接数据库写入或修改 Provider 凭证和系统权限。

## 2. 界面设计

### 2.1 桌面端布局

```text
顶部：工作流名称、版本状态、撤销/重做、运行、保存、AI 开关
中部：左侧节点工具栏 + 中央无限画布 + 右侧 AI 对话侧栏
底部：画布缩放、迷你地图、校验状态、运行状态
```

桌面端使用可展开/隐藏的右侧 AI 侧栏，宽度 `360-420px`，最小宽度 `320px`，支持拖拽调整。侧栏默认可以隐藏，不强制固定常驻；用户通过顶部 AI 按钮或快捷操作展开/收起。展开时侧栏不覆盖节点，画布动态让出侧栏空间并重新计算可视区域；隐藏时画布恢复全宽。窄屏时侧栏退化为右侧可拖拽抽屉，默认约占屏幕 `88%`，并提供“定位到刚修改节点”操作。

### 2.2 侧栏区域

从上到下包含：

- 上下文栏：工作流名称、节点数、当前 revision、未保存状态。
- 对话区：用户消息、AI 回复、工具活动状态、校验和错误结果。
- 操作记录：按用户消息聚合的 operation group，可查看变更、撤销本轮和定位节点。
- 输入区：自然语言、素材/资产引用和快捷指令。
- 状态条：思考中、检查中、修改中、校验中、已完成、需要补充信息或失败。

首次打开空白画布时，用户点击 AI 按钮展开侧栏后，显示“从一句话创建”“从模板开始”“分析当前画布”三个入口。AI 回复必须给出可理解的变更摘要，而不是只显示“完成”。收起侧栏后，顶部 AI 按钮显示未读变更/状态提示；重新展开时保留对话和操作记录。

### 2.3 AI Elements 组件复用策略

聊天基础交互优先复用 AI Elements 的 compound components，不在 Workflow 页面重新实现消息列表、输入框、附件预览或工具调用折叠。官方 AI Elements 是基于 shadcn/ui 的 registry source：组件源码安装到应用后由项目维护，而不是把一个不可定制的聊天黑盒作为运行时依赖。当前官方文档和上游实现参考如下（调研日期：2026-09-21）：

- [AI Elements 官方入口](https://elements.ai-sdk.dev)
- [上游仓库与固定提交](https://github.com/vercel/ai-elements/tree/6a9d5b1822ffb10bba4bd97175f01edd7d8651cd)
- [Conversation](https://github.com/vercel/ai-elements/blob/6a9d5b1822ffb10bba4bd97175f01edd7d8651cd/apps/docs/content/components/%28chatbot%29/conversation.mdx)：自动滚动、滚动到底部、空态和下载。
- [Message](https://github.com/vercel/ai-elements/blob/6a9d5b1822ffb10bba4bd97175f01edd7d8651cd/apps/docs/content/components/%28chatbot%29/message.mdx)：流式 Markdown、附件、分支和复制/重试等动作。
- [PromptInput](https://github.com/vercel/ai-elements/blob/6a9d5b1822ffb10bba4bd97175f01edd7d8651cd/apps/docs/content/components/%28chatbot%29/prompt-input.mdx)：输入、提交状态、附件、拖拽、截图、操作菜单和模型选择。
- [Tool / Confirmation](https://github.com/vercel/ai-elements/blob/6a9d5b1822ffb10bba4bd97175f01edd7d8651cd/apps/docs/content/components/%28chatbot%29/tool.mdx)：工具调用状态、输入/输出、错误和需要用户确认的状态。

本项目的共享组件边界是 `packages/workbench-ui/src/ai-elements`，页面代码通过 `@coworkany/workbench-ui` 导入；实施时应优先同步或迁移官方 registry 组件源码到该边界，并保留项目现有 Workbench tokens、ARIA 语义和宿主回调。不要未经评估直接新增 `ai-elements` 运行时包，也不要让页面同时依赖两套聊天 primitive。

组件映射：

| 工作流 AI 界面 | AI Elements 组件 | Workflow 专属扩展 |
| --- | --- | --- |
| 对话消息、流式 Markdown、复制/重试 | `Conversation`、`Message`、`MessageResponse`、`MessageActions` | 变更摘要、定位节点、撤销本轮 |
| 自然语言输入和附件/素材引用 | `PromptInput`、`PromptInputTextarea`、`PromptInputSubmit`、`Attachments` | 工作流素材选择、节点/画布上下文注入 |
| Provider/Model 选择 | `ModelSelector` 或 `PromptInputSelect` | 仅展示已配置且可用 Provider，显示费用和能力变化 |
| 工具调用及审批 | `Tool`、`ToolHeader`、`ToolInput`、`ToolOutput`、`Confirmation` | workflow tool 名称、operation group、revision 和 preflight 卡片 |
| 操作步骤和长任务状态 | `Task`、`Plan`、`Queue`、`Checkpoint` | 变更组进度、版本恢复、冲突和回滚状态 |
| 预算、费用和上下文 | `Context`（如适用） | Credits、预估费用、Provider 切换原因与确认 |

`Reasoning` 只可用于“检查端口/校验/重新布局”等可验证阶段状态；不得把模型内部 chain of thought 展示给用户。`Sources` 仅在确实有外部检索结果时使用，不作为工作流工具调用的替代展示。

迁移要求：现有 `components/ai-entry/prompt-kit/*` 仅作为兼容或迁移来源；新功能不得继续扩展这套旧 primitive。迁移完成后删除重复实现或明确其只负责兼容适配，并由共享 `workbench-ui` 测试覆盖 Web/Tauri 两端行为。

## 3. AI 工作流工具协议

### 3.1 工具集合

第一版工具包括：

- `inspect_workflow`：读取节点、边、参数、选择状态、运行状态和校验错误。
- `add_node`：按注册表中的 `nodeType` 创建节点。
- `update_node`：修改节点配置、名称、位置、Provider、模型和运行参数。
- `copy_node`：复制节点及允许复制的局部配置。
- `delete_node`：删除节点及其相关边。
- `connect_nodes` / `disconnect_nodes`：创建或删除带端口类型校验的连接。
- `update_port_mapping`：修改端口映射和输入引用。
- `group_nodes` / `ungroup_nodes`：创建或解除分组和子流程。
- `create_control_structure`：创建受支持的批量、条件和循环结构。
- `layout_nodes`：自动布局、整理选区或指定子图。
- `validate_workflow`：执行完整图校验。
- `focus_nodes`：定位画布视口到相关节点。
- `run_preflight`：检查必填参数、素材、Provider、权限和费用预估。
- `run_workflow`：仅在用户明确要求运行/测试并满足确认条件后调用现有运行入口。

不开放任意 JSON patch、任意代码、任意 URL、凭证写入或绕过校验的工具。

### 3.2 一轮对话事务

每条用户消息最多产生一个逻辑 operation group。AI 先读取当前 revision，再规划工具调用；工具调用按顺序执行，每一步经过 schema 和图校验。全部成功后提交新 revision，并记录摘要；中途失败时回滚本轮临时变更，不提交未完成事务。

```ts
type WorkflowAiOperationGroup = {
  id: string;
  conversationId: string;
  workflowId: string;
  baseRevision: number;
  resultRevision: number | null;
  operations: WorkflowAiOperation[];
  status: "applied" | "rolled_back" | "failed";
  summary: string;
  createdAt: string;
};
```

撤销和重做的单位是 operation group，而不是单个工具调用。回滚会生成新的 revision，不删除历史记录。

### 3.3 并发冲突

每个操作携带 `baseRevision`。如果用户在 AI 执行期间手动修改画布，AI 不覆盖用户修改，而是重新读取最新 revision，尝试重放尚未执行的操作。无法安全合并时停止本轮，并说明画布已变化，保留已提交历史和可恢复状态。

## 4. Provider 自动选择

所有已配置且当前可用的 Provider 都进入候选范围。AI 可根据任务能力、输入输出类型、可用模型、响应速度、可靠性和预计费用自主选择或切换 Provider。

AI 不得修改 Provider 凭证、账号配置、租户权限或系统级开关。Provider 切换必须记录在 operation group、运行事件和审计日志中。

默认授权规则：用户已配置的 Provider 均可使用。以下情况必须在执行前展示确认：预计费用明显增加、需要使用当前不可用的 Provider、超出租户 Credits/预算限制，或切换会改变输出能力/格式。失败切换可在授权范围内自动发生，并在结果摘要中说明原 Provider、替代 Provider、原因和费用变化。

## 5. 上下文与提示词策略

### 5.1 上下文分层

固定上下文包含租户/用户权限、节点注册表、端口和参数 schema、Provider capability、工具规则和安全限制。

工作流上下文包含 `workflowId`、`revision`、节点摘要、边摘要、校验错误、最近 operation groups、当前选择和视口。

按需上下文只在用户提及相关对象时读取节点完整配置、素材元数据、运行结果或历史版本差异，避免无差别暴露大对象和不必要的 token 消耗。

节点名称、文本输入和外部素材内容均为不可信数据，不能覆盖系统规则或诱导 AI 执行未授权工具。

### 5.2 行为规则

1. 先判断用户意图是创建、修改、解释、校验还是运行。
2. 变更前读取当前 revision 和相关节点。
3. 只使用注册表中存在的节点、端口、参数和 Provider capability。
4. 优先复用已有节点，避免无必要重复创建。
5. 关键信息不确定时提问，不猜 Provider、素材、模型或参数。
6. 变更后必须调用 `validate_workflow`。
7. 默认不运行工作流，除非用户明确要求运行/测试。
8. 使用自然语言总结变更、校验、Provider 切换、费用和潜在问题。

## 6. 循环与控制结构

AI 可以创建 Workflow Core 支持的批量、条件和循环结构。第一版的循环必须是有限循环：显式条件、最大迭代次数、超时和取消信号均不可缺失。每轮状态、Attempt、Provider 调用、费用和输出都必须可持久化和恢复，禁止无限循环。

这里不承诺任意回边的自由循环图。任意回边需要额外的执行计划、恢复、预算和画布校验设计，作为后续能力；当前只支持有明确边界的控制结构。

## 7. 错误、确认与展示

错误分为：

- 可自动修复：端口不匹配、默认布局缺失、参数格式错误。最多自动修复并重试一次。
- 需要用户选择：多个模型、多个同名节点、素材或模板不明确。使用可点击选项提问。
- 不可继续：权限不足、Provider 不可用、图结构非法、预算不足或外部任务失败。回滚未完成事务并保留错误历史。

每个错误必须说明发生了什么、影响对象、是否回滚以及用户可以采取的动作。

工具调用卡片应使用 AI Elements 的状态模型（输入流式、输入可用、等待确认、输出可用、输出错误、拒绝），把 workflow 工具的结构化输入/输出放在可折叠内容中。需要用户授权的高费用 Provider 切换、运行和不可逆批量删除，应使用 `Confirmation`，确认结果写入同一 operation group 或运行审计事件。

AI 思考过程不直接展示，只展示“检查端口”“正在修改”“正在重新布局”等可验证活动状态。每轮变更显示“查看变更”“撤销本轮”“定位节点”。

## 8. 典型用户流程

### 8.1 从目标创建

用户描述目标；AI 识别所需节点并询问关键缺失信息；随后创建节点、连接、参数和布局，校验后显示节点/边数量、Provider 选择和运行前问题。

### 8.2 增量修改

用户要求增加、删除、复制、重连、配置或重构节点。AI 定位相关节点，执行工具调用，校验图，生成一个可撤销 operation group。

### 8.3 解释和诊断

用户询问不能运行的原因；AI 读取校验错误和相关配置，解释根因；用户确认修复后，AI 执行变更并重新校验。

### 8.4 测试运行

用户明确要求测试运行；AI 先执行 preflight，展示必填参数、Provider、Credits 和预计费用；满足确认条件后调用现有运行入口。

## 9. MVP 与后续边界

MVP 包含：自然语言创建工作流、完整节点/边/分组/控制结构操作、Provider 自动选择与授权范围内切换、自动布局、图校验、operation group 撤销/重做、节点与素材引用、运行前检查和显式执行。

后续再考虑：多人实时协作、修改运行历史、无限或无界回边、任意代码/HTTP 工具、AI 修改 Provider 账号配置，以及跨租户 Provider 管理。

## 10. 验收标准

- 用户可以从空白画布通过自然语言生成可校验的工作流。
- AI 侧栏可以展开和隐藏，隐藏时画布恢复全宽，展开时不覆盖节点。
- AI 可以对工作流和节点执行所有受 Workflow Core 支持的合法编辑操作。
- 每轮 AI 修改都形成可查看、可审计、可整组撤销的 operation group。
- Provider 仅从已配置且可用范围选择；自动切换能说明原因和费用变化。
- Provider、参数、端口和节点均遵守现有 registry/schema/权限约束。
- 用户手动修改与 AI 修改发生冲突时不会静默覆盖。
- 有界循环具备最大迭代次数、超时、取消、持久化和恢复能力。
- AI 未获得任意代码、任意 URL、凭证或直接数据库写入权限。
- 明确要求运行前，AI 不会提交工作流运行。
- 聊天消息、输入、附件、工具调用、审批和滚动行为由共享 AI Elements 组件提供；Workflow 页面只实现侧栏布局、变更摘要、revision/operation group 和业务确认扩展。
- Web 与 Tauri 均从 `@coworkany/workbench-ui` 使用同一套 AI Elements 组件边界，不形成第二套页面级聊天 primitive。

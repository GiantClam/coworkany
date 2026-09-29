## Context

现有实现已经具备工作流节点注册表、图结构验证、AI allowlist 命令、操作组、Provider 过滤、右侧对话侧栏和画布级 Undo/Redo。当前主要缺口不是“能否修改图”，而是模型缺少稳定的工作流设计知识和可机械验证的语义目标：模板卡片在 `App.tsx` 中声明，部分模板构建器位于独立文件，模板选择与 AI 提示之间没有共享协议。

工作流执行仍由共享 `workflow-core` 和桌面 host 负责；Provider 凭据不得进入模型上下文、模板或 Skill。参见 `proposal.md` 与两个 capability specs。

## Goals / Non-Goals

**Goals:**

- 让 UI、AI、测试和模板构建器共享一个可版本化、可验证的黄金模板注册表。
- 把自然语言意图编译为可验证的能力计划，再编译为一个原子操作组。
- 将拓扑决策留给计划器，将坐标、验证、审批和历史交给确定性代码。
- 在不配置媒体 Provider 的情况下仍能得到结构完整、明确待配置的工作流。

**Non-Goals:**

- 不让 Skill 直接执行任意代码、文件、网络或数据库操作。
- 不引入第二套 Undo/Redo、模板数据库或独立工作流 DSL。
- 不自动升级历史工作流，不在本变更中开放用户自定义黄金模板市场。
- 不把工作流助手扩展为图片、音频或视频推理模型。

## Decisions

### 1. Skill owns authoring policy; typed code owns authority

新增 `workflow-authoring` 系统 Skill，描述意图分解、能力选择、黄金模板使用和修复策略。Skill 输出必须落入版本化的结构化计划协议；控制器只接受 allowlist 操作，核心包负责验证和应用。

选择该分层是因为 Skill 适合维护可迭代的设计知识，但不能作为安全或一致性边界。仅扩充一个超长系统提示词会继续让 UI、模板和校验逻辑漂移；让 Skill 直接操作文件又会突破现有沙箱边界。

### 2. Use one registry descriptor with host-supplied instantiation context

共享核心定义黄金模板 descriptor：稳定 key/version、能力标签、配置要求、来源与校验结果。桌面注册表组合本地化元数据和 builder，并通过公开的实例化上下文注入可用 Provider 标识、模型标识和区域设置。

工作流目录、AI prompt-safe catalog 和模板测试都从该注册表派生。不会把桌面 Provider 类型导入 `workflow-core`，也不会在 UI 中保留 template-id switch。这样既保持核心 host-neutral，又消除当前分散清单。

### 3. Compile request through intent, template and operation phases

处理流水线固定为：

1. 将请求归一化为 `intent`、`requiredCapabilities` 和 `assumptions`。
2. 按能力覆盖、配置适用性、结构距离与稳定排序选择一个主模板。
3. 实例化主模板或从当前定义开始，计算满足目标的最小差异。
4. 由确定性布局器生成坐标。
5. 执行图结构与语义能力验证。
6. 首次失败时把精简校验结果反馈给计划器修复一次。
7. 将最终命令作为一个操作组审批并原子应用。

直接让模型输出最终 JSON 图被拒绝：它难以保留节点身份、解释差异、控制变更规模或可靠回滚。

### 4. Capabilities are stable machine-readable identifiers

节点定义与黄金模板声明稳定能力标识，例如 `article-generation`、`image-generation`、`presentation-generation`、`media-transform` 和 `result-composition`。语义验证器从节点类型、有效配置和可达路径推导实际能力，并与计划目标比较；节点标题和本地化描述不参与权威判断。

首版能力表保持小而显式。自由文本 embedding 匹配被拒绝，因为它不可重复，也无法为“为什么图文文章缺少图片节点”提供确定测试。

### 5. Template matching is deterministic before model tie-breaking

匹配器先排除不覆盖主要意图或节点版本不兼容的模板，再按能力覆盖率、需新增节点数、待配置数量和稳定 key 排序。只有同分或需要风格判断时才让文本模型在候选中选择。

一个计划只能有一个主模板。来自其他模板的复用单元必须是注册并单独验证的子图；不允许合并两个完整模板。

### 6. Minimal diff preserves identity and provenance

对于现有图，diff 以 `nodeKey` 和端口身份为基础，先复用满足能力的节点，再更新配置、补节点和连边。模板实例记录 `templateKey`/`templateVersion`；后续修改只更新 workflow revision，不改写来源版本。

模板升级使用显式 upgrade plan，而不是加载时迁移。该策略避免覆盖用户配置，并保持 Undo/Redo 与导入导出行为可预测。

### 7. Layout is deterministic and loops are explicit control structures

模型只声明分层、分支、分组和期望顺序。布局器基于 DAG 层级、固定间距和稳定 node-key 顺序分配坐标，并在局部修改时尽量保留未涉及节点的位置。

循环需求编译为已注册的 `foreach`/`collect` 控制结构。任何普通边构成的环都由验证器拒绝，不把“真正自由循环图”解释为可任意创建不可执行环。

### 8. Approval and history wrap the complete operation group

控制器在计划完成后计算风险：运行、两节点及以上删除、不可逆覆盖和新增超过 20 节点需要批准；已配置文本 Provider 切换和常规编辑直接应用。批准对象是完整操作组，而不是单条命令。

成功应用调用画布已有的统一 history commit 一次。AI 侧栏只渲染请求摘要、批准卡和最终结果；Undo/Redo 继续位于工作流顶栏并作用于全图。

### 9. Provider selection has two distinct scopes

工作流助手推理模型只从可用文本 Provider 中选择，并可自动在其间切换。节点执行 Provider 根据节点 capability 独立绑定；缺失时保留空绑定和 `needs-config`，不会退化为伪 Provider。

把助手模型与节点执行模型混在同一候选列表的方案被拒绝，因为会让图片或视频模型进入对话选择器，也无法准确表达待配置节点。

### 10. Golden templates are build-time and test-time gated

注册表加载时进行轻量 schema 检查；CI 对每个模板版本执行完整实例化、图验证、能力推导、凭据扫描、稳定性和目录快照测试。验证失败的条目不进入发布产物。`needs-config` 是合法产品状态，不等于模板无效。

## Risks / Trade-offs

- [能力标签过粗导致错误匹配] → 为每个黄金模板和典型请求增加能力覆盖 fixture；能力表变更要求版本化测试。
- [Skill 与 typed schema 漂移] → Skill bundle 测试校验协议版本与必需字段，控制器对未知字段 fail closed。
- [最小差异算法保留了错误旧结构] → 语义验证检查从输入到输出的可达能力路径，而不仅是节点存在性。
- [一次修复仍无法满足复杂请求] → 不应用部分结果，返回精简缺失项，让用户补充需求或重新请求。
- [集中注册表形成大型模块] → descriptor、builder 和 validation 分层，但通过单一公开 registry export 组合。
- [模板升级积累旧版本工作流] → 保持读取兼容，并用显式升级计划处理；不引入静默迁移。

## Migration Plan

1. 建立能力标识、计划 schema、黄金模板 descriptor 和只读注册表测试，不改变现有 UI 行为。
2. 将七个目录模板及其 builder 迁入共享注册表，保持现有 template key、展示文案和创建结果兼容。
3. 打包 `workflow-authoring` 系统 Skill，并让工作流 AI transport 携带计划协议版本与 prompt-safe 黄金模板 catalog。
4. 接入语义验证、一次修复、确定性布局和审批/节点数规则。
5. 将成功操作组接入现有全局 history commit，并更新侧栏只显示摘要。
6. 运行模板、core、client、desktop、导入导出、类型检查、构建和桌面回归测试。

回滚时可停用 Skill/计划器入口并恢复旧 AI prompt；注册表继续作为工作流目录来源，不需要迁移用户数据。已有工作流不做批量更新。

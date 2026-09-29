## Purpose

定义工作流画布中的 AI 助手如何通过专用 Skill、结构化计划和受验证的原子操作创建、修改、诊断、修复与验证工作流，同时保持 Provider、审批、历史和用户反馈边界一致。

## ADDED Requirements

### Requirement: Workflow authoring intent SHALL activate a dedicated built-in Skill

系统 SHALL 为工作流创建、修改、诊断、修复和验证提供一个内置、版本化的工作流创作 Skill。只有当用户表达上述工作流操作意图时才 SHALL 加载该 Skill；一般解释、问答或帮助请求 MUST NOT 自动修改工作流。

#### Scenario: User asks to create a workflow

- **WHEN** 用户要求创建、调整、检查或修复当前工作流
- **THEN** 系统 SHALL 使用工作流创作 Skill 规划该请求
- **AND** 规划和执行只能使用已注册的工作流能力与允许的操作

#### Scenario: User asks a conceptual question

- **WHEN** 用户只询问某种节点或工作流概念而没有要求修改
- **THEN** 助手 SHALL 直接回答
- **AND** MUST NOT 提交工作流操作组

### Requirement: Every mutating request SHALL produce a structured semantic plan

在提交变更前，助手 SHALL 生成结构化计划，至少包含 `intent`、`requiredCapabilities`、`selectedTemplate`、`templateVersion`、`assumptions`、`operations` 和 `validationResult`。`requiredCapabilities` SHALL 使用稳定的能力标识，不得从本地化标题推断节点是否满足能力。

#### Scenario: User requests an illustrated article workflow

- **WHEN** 用户要求当前工作流生成图文混排文章
- **THEN** 计划 SHALL 声明文章生成、图片生成和结果组合能力
- **AND** 最终图结构 SHALL 包含实际提供这些能力的节点及兼容连边
- **AND** 仅把现有节点改名为“图文混排” SHALL 被语义验证拒绝

#### Scenario: No mutation is required

- **WHEN** 检查结果表明当前图已经满足用户意图
- **THEN** 助手 SHALL 返回验证摘要和相关节点
- **AND** SHALL NOT 生成空操作组或无意义改名操作

### Requirement: The assistant SHALL preserve the existing workflow by default

修改现有工作流时，助手 SHALL 采用最小差异策略，保留仍然有效的节点标识、配置、连边、模板来源和工作流历史。只有用户明确要求重建时，系统才 MAY 用新图替换现有结构。

#### Scenario: Existing nodes already satisfy part of the request

- **WHEN** 当前工作流已有可复用的文章生成节点
- **THEN** 助手 SHALL 保留该节点及其有效配置
- **AND** 只增加或修改满足缺失能力所需的最小结构

#### Scenario: User explicitly requests a rebuild

- **WHEN** 用户明确要求从头重建当前工作流
- **THEN** 助手 MAY 提出替换现有结构的计划
- **AND** 不可逆覆盖仍 SHALL 进入审批流程

### Requirement: The assistant SHALL support the complete allowlisted graph operation set

助手 SHALL 能对节点、配置、端口映射、连边、分组、受控结构、布局和焦点执行所有已注册且允许的工作流操作。系统 MUST NOT 向模型开放 shell、文件系统、数据库、凭据、任意 HTTP、代码执行或 JSON Patch 能力。

#### Scenario: A request needs structural changes

- **WHEN** 用户请求的能力在当前图中不存在
- **THEN** 助手 SHALL 使用增加节点、更新配置和连接端口等结构操作满足请求
- **AND** MUST NOT 用标题修改冒充结构变化

#### Scenario: A model emits a non-allowlisted operation

- **WHEN** 计划包含任意未注册或越过工作流边界的操作
- **THEN** 系统 SHALL 在应用前拒绝整个操作组
- **AND** 当前工作流 SHALL 保持不变

### Requirement: Ambiguity SHALL be resolved without unnecessary interruption

只有当不同解释会实质改变拓扑、破坏现有数据或触发不同审批边界时，助手才 SHALL 请求用户澄清。否则助手 SHALL 选择安全默认值、记录假设并继续生成计划。

#### Scenario: A missing preference does not change topology

- **WHEN** 用户未指定布局方向或非关键展示文案
- **THEN** 助手 SHALL 使用确定性默认值继续
- **AND** SHALL 在 `assumptions` 中披露该默认值

#### Scenario: Two interpretations require different graph structures

- **WHEN** 用户意图存在会产生显著不同节点或数据流的歧义
- **THEN** 助手 SHALL 在修改前提出一个最小澄清问题
- **AND** MUST NOT 猜测并提交其中一种拓扑

### Requirement: Workflow AI SHALL use configured text models only

工作流助手的模型候选 SHALL 仅包含已配置且可用的文本模型。助手 MAY 在这些候选中自主选择或切换 Provider，包括已配置的付费 Provider；该选择本身 MUST NOT 要求审批。媒体节点的 Provider 选择 SHALL 继续遵守节点能力兼容性。

#### Scenario: Non-text models exist in configuration

- **WHEN** 配置同时包含文本、图片、视频和音频模型
- **THEN** 工作流助手的模型选择器和模型上下文 SHALL 只包含文本模型
- **AND** 媒体模型 MUST NOT 被用作助手推理模型

#### Scenario: Another configured text Provider is more suitable

- **WHEN** 当前文本 Provider 不可用或另一个已配置文本 Provider 更适合本次规划
- **THEN** 助手 MAY 自动切换到该 Provider
- **AND** MUST NOT 因付费属性单独请求批准

### Requirement: Missing execution Providers SHALL not prevent complete graph creation

如果目标工作流需要尚未配置的媒体或其他执行 Provider，助手仍 SHALL 创建语义完整的节点和连边，并把相关节点标记为待配置。助手 MUST NOT 虚构 Provider、凭据、品牌信息、本地路径或用户资产。

#### Scenario: Image generation is required but no image Provider is configured

- **WHEN** 用户要求图文文章且没有可用图片 Provider
- **THEN** 生成结果 SHALL 仍包含图片生成节点及其数据流
- **AND** 该节点 SHALL 明确标记为待配置
- **AND** 系统 MUST NOT 填入伪造的 Provider 或模型标识

### Requirement: One user request SHALL map to one atomic workflow history entry

一次用户请求产生的全部工作流变更 SHALL 作为一个原子操作组应用，并在整个工作流的统一 Undo/Redo 历史中形成一个历史项。任何命令失败时，系统 SHALL 回滚整个操作组且不得留下部分变更。

#### Scenario: Undo an AI-authored multi-node change

- **WHEN** 一次 AI 请求增加多个节点并连接多个端口且操作组成功应用
- **THEN** 工作流顶部的全局 Undo SHALL 一次恢复请求前的完整工作流
- **AND** Redo SHALL 一次恢复该完整操作组

#### Scenario: One command in the group fails

- **WHEN** 操作组中任意节点、端口、连边或版本校验失败
- **THEN** 整个操作组 SHALL 失败
- **AND** 工作流定义与历史 SHALL 保持请求前状态

### Requirement: High-impact actions SHALL require explicit approval

运行工作流、一次删除两个或更多节点、不可逆覆盖以及一次请求新增超过 20 个节点 SHALL 在执行前展示计划并取得用户确认。已配置文本 Provider 的自动选择或切换、普通增加/修改/连边和单节点删除 MUST NOT 因为由 AI 发起而额外要求批准。

#### Scenario: AI proposes a workflow run

- **WHEN** 用户明确要求运行或测试工作流且预检通过
- **THEN** 助手 SHALL 展示运行审批
- **AND** 只有用户批准后才 SHALL 提交运行

#### Scenario: AI proposes a large graph

- **WHEN** 单次请求会新增超过 20 个节点
- **THEN** 系统 SHALL 展示节点数量、能力和操作摘要
- **AND** 未获得批准前 MUST NOT 修改工作流

#### Scenario: AI switches a configured text Provider

- **WHEN** 助手在已配置且可用的文本 Provider 之间切换
- **THEN** 系统 SHALL 继续规划请求
- **AND** MUST NOT 仅因 Provider 是付费服务而阻塞审批

### Requirement: Validation SHALL cover graph integrity and requested semantics

系统 SHALL 在应用前验证节点类型与版本、端口兼容、连边、循环、配置、模板来源和 `requiredCapabilities`。首次验证失败后，助手 MAY 自动修复一次；第二次失败 SHALL 放弃整个变更，并向用户列出未满足能力和具体校验问题。

#### Scenario: First candidate omits a required capability

- **WHEN** 初始候选图缺少 `requiredCapabilities` 中的图片生成能力
- **THEN** 系统 SHALL 拒绝该候选并允许一次受约束的自动修复
- **AND** 只有修复后的完整图通过全部验证才 SHALL 应用

#### Scenario: Repair still fails

- **WHEN** 一次自动修复后仍存在图结构或语义问题
- **THEN** 系统 SHALL 不提交任何变更
- **AND** 助手 SHALL 展示缺失能力、无效节点或不兼容连边的摘要

### Requirement: Cycles and layout SHALL be deterministic and executable

助手 MUST NOT 创建原始循环边。重复和聚合逻辑 SHALL 使用已注册的 `foreach`、`collect` 或等价受控节点表达。模型 SHALL 决定拓扑与分组意图，确定性布局器 SHALL 负责最终坐标。

#### Scenario: User requests repeated processing

- **WHEN** 用户要求对一组项目逐项生成内容并汇总
- **THEN** 助手 SHALL 使用受控迭代与聚合节点
- **AND** 图验证 SHALL 拒绝普通节点之间形成的裸循环

#### Scenario: Equivalent plan is generated twice

- **WHEN** 相同拓扑与布局约束被再次处理
- **THEN** 布局器 SHALL 生成稳定、无重叠且方向一致的节点坐标
- **AND** 模型提供的任意自由坐标 MUST NOT 绕过布局规则

### Requirement: The AI sidebar SHALL remain optional and history-neutral

工作流 AI SHALL 显示在可展开、可隐藏的右侧侧栏中，而不是固定占据画布。会话 SHALL 展示用户消息、助手摘要、待审批动作和本次操作结果，但 MUST NOT 展示 Undo/Redo 的详细记录或建立独立的 AI 历史控件。

#### Scenario: User hides the AI sidebar

- **WHEN** 用户收起右侧 AI 侧栏
- **THEN** 画布 SHALL 释放对应空间并保持可编辑
- **AND** 再次展开时当前工作流 AI 会话 SHALL 继续可用

#### Scenario: AI operation is undone globally

- **WHEN** 用户使用工作流顶部的全局 Undo 撤销一次 AI 操作
- **THEN** AI 侧栏 MAY 保留原始操作摘要作为会话记录
- **AND** MUST NOT 展示独立 Undo/Redo 详情、按钮或第二套历史状态

### Requirement: Historical workflows SHALL not be silently migrated

系统 MUST NOT 因引入新 Skill、验证器或模板版本而自动重写历史工作流。只有新的用户修改请求或明确的“检查并修复”请求才 MAY 产生修复操作组。

#### Scenario: Open an older workflow

- **WHEN** 用户打开在本变更之前创建的可读取工作流
- **THEN** 系统 SHALL 原样加载其定义
- **AND** MUST NOT 因模板或 Skill 更新自动提交修改

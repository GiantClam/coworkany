## Purpose

定义工作流目录中的内置模板如何作为 AI 与用户界面共用的版本化黄金模板，包括能力标注、匹配、实例化、组合、来源追踪、待配置状态和发布准入验证。

## ADDED Requirements

### Requirement: Built-in workflow templates SHALL have one shared source of truth

工作流目录与工作流 AI SHALL 消费同一个版本化黄金模板注册表。每个模板条目 SHALL 提供稳定的 `templateKey`、`templateVersion`、本地化展示元数据、稳定能力标签、构建方式、配置要求和验证状态；UI 或 AI MUST NOT 维护平行的模板清单或独立构建分支。

#### Scenario: A template is shown in the workflow directory

- **WHEN** 工作流目录加载内置模板
- **THEN** 卡片元数据和可用状态 SHALL 来自黄金模板注册表
- **AND** AI 获得的候选模板 SHALL 来自同一条目

#### Scenario: A template definition changes

- **WHEN** 开发者修改模板图结构或能力标签
- **THEN** 变更 SHALL 在同一注册条目中完成并增加 `templateVersion`
- **AND** UI 与 AI MUST NOT 出现不同版本的模板定义

### Requirement: The initial golden catalog SHALL contain the current built-in directory templates

初始黄金模板注册表 SHALL 至少包含 `content-pipeline`、`presentation`、`image-campaign`、`video-ffmpeg-transform`、`audio-ffmpeg-trim`、`product-promotion-video` 和 `character-swap-video`。新增模板 SHALL 通过同一注册和验证流程进入目录与 AI 候选集。

#### Scenario: Load the initial catalog

- **WHEN** 应用加载黄金模板注册表
- **THEN** 注册表 SHALL 返回上述七个稳定模板标识且不得重复
- **AND** 每个模板 SHALL 有正整数版本和非空能力标签

### Requirement: Template matching SHALL use stable capability tags

模板匹配 SHALL 首先依据 `requiredCapabilities`、节点兼容性和配置约束确定候选，再对候选进行确定性排序；本地化名称与描述 SHALL 只用于展示，不得作为唯一或权威匹配依据。模型 MAY 在同分候选中选择最符合用户意图的模板。

#### Scenario: Match an illustrated article request

- **WHEN** 计划要求文章生成、图片生成和结果组合能力
- **THEN** 匹配器 SHALL 优先返回覆盖这些稳定能力标签的模板
- **AND** MUST NOT 因某个无关模板标题包含“图文”而选择它

#### Scenario: Locale changes

- **WHEN** 用户在中文和英文之间切换
- **THEN** 相同 `requiredCapabilities` SHALL 得到相同模板候选顺序
- **AND** 只有标题和描述 SHALL 随语言改变

### Requirement: AI SHALL adapt the closest valid golden template before free-form generation

当存在满足主要能力的黄金模板时，助手 SHALL 先实例化一个主模板，再以最小差异补齐用户需求。只有没有可用主模板时，助手才 MAY 根据节点注册表自由构建工作流。

#### Scenario: A close template exists

- **WHEN** 一个黄金模板覆盖请求的大部分必需能力
- **THEN** 计划 SHALL 记录该模板的 key 和版本
- **AND** 操作 SHALL 以该模板为基线，仅调整缺失或冲突部分

#### Scenario: No template covers the primary intent

- **WHEN** 所有黄金模板均无法覆盖请求的主要能力
- **THEN** 计划 SHALL 将 `selectedTemplate` 明确记录为空
- **AND** 助手 MAY 使用注册节点自由构建，但仍 SHALL 通过同一语义与图验证

### Requirement: Template composition SHALL use one primary template and validated subgraphs

每个计划最多 SHALL 选择一个主模板。助手 MAY 从其他黄金模板复用已验证且边界明确的子图，但 MUST NOT 直接拼接多个完整模板产生重复入口、重复输出或不兼容连边。

#### Scenario: A request needs capabilities from two templates

- **WHEN** 主模板缺少一个可由其他黄金模板中独立子图提供的能力
- **THEN** 助手 MAY 复用该已验证子图并重新绑定兼容端口
- **AND** 最终图 SHALL 只有预期的入口、出口和控制结构

### Requirement: Instantiated workflows SHALL record template provenance

从黄金模板创建或改编的工作流 SHALL 在元数据中记录 `templateKey` 和 `templateVersion`。后续用户编辑 SHALL 保留该来源，除非用户明确从空白重建或移除来源。

#### Scenario: Create a workflow from a golden template

- **WHEN** 用户或 AI 实例化黄金模板
- **THEN** 新工作流元数据 SHALL 记录所用模板 key 和版本
- **AND** 导出后再次导入 SHALL 保留这些字段

### Requirement: Template upgrades SHALL not silently alter instantiated workflows

黄金模板发布新版本时，系统 MUST NOT 自动更新已经实例化的工作流。系统 MAY 提示可用升级或生成显式的升级计划，但实际迁移 SHALL 作为独立原子操作并遵守审批和验证规则。

#### Scenario: Open a workflow created from an older template version

- **WHEN** 注册表中存在更高版本的同一模板
- **THEN** 工作流 SHALL 继续使用其当前定义
- **AND** MUST NOT 在加载时被新模板覆盖

### Requirement: Golden templates SHALL pass release validation

进入黄金注册表并向用户或 AI 暴露的模板 SHALL 通过节点类型和版本、端口、连边、配置 schema、受控循环、能力标签、确定性实例化和自动化测试。处于 `needs-config` 的模板 MAY 发布；结构或语义无效的模板 MUST NOT 发布。

#### Scenario: A template requires an unconfigured Provider

- **WHEN** 模板图结构有效但当前没有其媒体 Provider
- **THEN** 注册表 SHALL 将模板标记为 `needs-config` 并保持可见、可实例化
- **AND** 需要该 Provider 的节点 SHALL 保持待配置状态

#### Scenario: A template fails semantic validation

- **WHEN** 模板声明图片生成能力但定义中没有实际图片生成路径
- **THEN** 构建或测试 SHALL 失败
- **AND** 该模板 MUST NOT 进入运行时黄金候选集

### Requirement: Golden template builders SHALL be deterministic and credential-free

在相同模板版本、区域设置和公开配置状态下，模板实例化 SHALL 产生语义等价且稳定的图。模板定义 MUST NOT 包含 API key、token、用户本地绝对路径或其他秘密；Provider 配置 SHALL 通过实例化上下文绑定或保持待配置。

#### Scenario: Instantiate the same template twice

- **WHEN** 使用相同输入两次实例化同一模板版本
- **THEN** 两个定义 SHALL 具有相同节点类型、稳定节点键、连边和能力结果
- **AND** 哈希差异只 MAY 来自明确允许的实例级元数据

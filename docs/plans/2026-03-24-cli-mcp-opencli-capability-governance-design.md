# CLI / MCP / Tool 能力收敛设计（含 OpenCLI 集成）

> 日期：2026-03-24  
> 适用仓库：CoworkAny (`desktop + sidecar`)  
> 目标：建立完整 CLI 支撑体系，解决 CLI 与 Builtin/MCP 的重复、互斥与覆盖冲突，并接入 `jackwener/opencli`，强化本机软件操作能力。

## 1. 背景与问题

CoworkAny 当前已具备：

- Builtin Tool 体系
- MCP Gateway + Toolpack 治理
- SkillHub CLI 安装与市场流程
- 命令风险规则（Regex 级）

但在“CLI-first”诉求下有三类结构性缺口：

1. 没有统一能力模型：同一能力来自 Builtin/MCP/CLI 时，缺少统一语义与冲突判定。
2. 当前覆盖规则过于粗糙：同名工具直接覆盖，无法做“部分重叠、互斥条件、动态回退”。
3. 本机软件操作粒度不足：仅有命令危险词过滤，缺少“二进制级 + 参数级 + 上下文级”的授权治理。

## 2. 设计目标与非目标

### 2.1 目标

- 统一描述 Builtin / MCP / CLI / OpenCLI 能力，形成可计算的 `Capability Catalog`。
- 自动判定能力关系：`duplicate` / `overlap` / `mutex` / `replaceable`。
- 引入策略优先的运行时路由，支持可解释决策与回退。
- OpenCLI 作为一级 Provider 集成（可发现、可执行、可治理）。
- 强化本机软件操作（读取、调用、安装、变更）安全边界。

### 2.2 非目标

- 不在本阶段替换现有 MCP Gateway 核心生命周期逻辑。
- 不在本阶段重写整个权限引擎（仅扩展现有策略输入与授权域）。

## 3. 单一推荐方案（最优）

采用“`能力图谱 + 决策路由 + 治理前置`”三层架构。

- 层 1：`Capability Catalog`
  - 所有工具（Builtin/MCP/CLI/OpenCLI）转为统一 `CapabilityDescriptor`。
- 层 2：`Conflict Analyzer`
  - 对 descriptor 自动打关系标签（重复/重叠/互斥/可替换）。
- 层 3：`Policy-first Resolver`
  - 先安全与会话策略，再质量评分，再执行与回退。

这比“按来源优先级硬编码覆盖”更稳健，且可解释。

## 4. 核心数据结构

```ts
export type CapabilityProvider = 'builtin' | 'mcp' | 'cli' | 'opencli';

export type InteractionMode = 'non_interactive' | 'tty_required' | 'gui_required' | 'browser_session';

export type CapabilityDescriptor = {
  capabilityId: string;                // 稳定ID: action.resource.variant
  provider: CapabilityProvider;
  providerToolId: string;              // 如 github-server:list_repos / opencli:gh.repo.list
  displayName: string;
  description: string;

  // 语义轴
  action: string;                      // read/write/search/create/delete/execute/install...
  resource: string;                    // file/repo/email/calendar/process/app...
  scope: 'workspace' | 'host' | 'network' | 'service';

  // 执行与风险轴
  effects: string[];                   // filesystem:read, process:spawn, network:outbound...
  interactionMode: InteractionMode;
  requiresAuth: boolean;
  requiresNetwork: boolean;

  // 契约轴
  inputSchema: Record<string, unknown>;
  outputShape: 'text' | 'json' | 'structured_json' | 'binary';

  // 治理轴
  trustTier: 0 | 1 | 2 | 3;            // builtin > signed mcp/opencli > unsigned
  defaultEnabled: boolean;
  version?: string;
  sourceRef?: string;
};
```

## 5. 重复、互斥、覆盖识别规则

## 5.1 归一化

- 先做 `action/resource/effects` 归一化词典（例如 `list_dir` / `ls` / `opencli.fs.list` → `read.file_listing`）。
- 对 schema 计算兼容度：参数覆盖率 + 必填字段映射率。

## 5.2 关系判定

- `duplicate`：语义轴一致 + effect 一致 + schema 兼容度高（如 >= 0.85）。
- `overlap`：语义相近，但 effect 或输出契约不同。
- `mutex`：前置条件冲突（TTY 必需 vs 非交互；GUI 必需 vs 无桌面；host 写权限不满足）。
- `replaceable`：允许替换但需满足策略门（用户偏好、信任级、审批状态）。

## 5.3 覆盖与回退

- 默认不做“裸覆盖”，改为“虚拟能力入口 + 多候选执行器”。
- 当首选执行器失败时，按策略允许的候选自动回退。

## 6. 运行时路由策略

```ts
resolveCapability(intent, sessionPolicy) {
  candidates = catalog.search(intent);

  // A. 安全剪枝（强约束）
  candidates = candidates.filter(c => policyAllows(c, sessionPolicy));

  // B. 互斥剪枝
  candidates = candidates.filter(c => !isMutex(c, runtimeContext));

  // C. 评分排序（软约束）
  score = wTrust*trustTier + wFit*semanticFit + wPerf*successRate - wRisk*riskScore - wCost*latency;

  selected = top(candidates);
  result = execute(selected);

  if (failed && hasFallback) {
    return execute(nextCandidate);
  }
  return result;
}
```

策略顺序固定：

1. 显式禁用/allowlist（硬限制）
2. 风险与审批（硬限制）
3. 用户偏好（如偏好 CLI）
4. 质量评分（成功率、时延、稳定性）

## 7. OpenCLI 集成设计

## 7.1 Provider 角色

OpenCLI 不作为普通 `run_command`，而作为独立 provider：

- 可发现：`opencli list` 导出能力目录
- 可执行：`opencli exec`（或子命令）统一入口
- 可体检：`opencli doctor`
- 可注册：`opencli register`（受治理）

## 7.2 适配器

新增 `OpenCliAdapter`：

- 周期性或按需刷新 OpenCLI 可用命令并转 `CapabilityDescriptor`
- 生成 `providerToolId = opencli:<namespace>.<command>`
- 输出统一 JSON 结构（失败原因、退出码、stdout/stderr）

## 7.3 关键策略

- 禁止默认无审查自动安装外部 CLI（高风险，需审批）。
- 对 OpenCLI 命令启用“二进制 + 参数模板”授权。
- 对 `tty_required` 命令强制交互确认或拒绝自动执行。

## 8. 本机软件操作增强

在现有 HostAccess 之上新增 `BinaryAccessGrant`：

```ts
type BinaryAccessGrant = {
  binaryPath: string;                  // /usr/bin/git
  allowedArgPatterns: string[];        // 例如 ^(status|log|diff)$
  cwdScope: 'workspace_only' | 'host_path_allowlist';
  network: 'inherit' | 'deny' | 'restricted';
  requiresTty: boolean;
  scope: 'session' | 'persistent';
  expiresAt?: string;
};
```

这使“可运行命令”从字符串过滤升级为结构化治理：

- 运行哪个二进制
- 允许哪些参数组合
- 可在哪些目录执行
- 是否允许联网/TTY

## 9. 与当前代码的改造映射

优先改造点（从低风险到高收益）：

1. `sidecar/src/tools/taskToolResolver.ts`
   - 由“同名替换”改为“构建候选集合 + 路由决策”。
2. `sidecar/src/mcp/gateway/index.ts`
   - 输出 descriptor 所需元信息（effect、health、source）。
3. `sidecar/src/tools/appManagement.ts`
   - 复用 SkillHub CLI 集成模式，新增 OpenCLI 管理工具。
4. `sidecar/src/tools/commandSandbox.ts`
   - 从 regex 风险提示扩展到二进制级策略校验入口。
5. `sidecar/src/security/hostAccessGrantManager.ts`
   - 扩展为路径授权 + 二进制授权双轨模型。
6. `docs/tool-system.md`
   - 将“固定 MCP 最高优先级”更新为“策略驱动动态路由”。

## 10. 分阶段实施计划

### Phase 1（1-2 周）能力目录与冲突识别

- 实现 `CapabilityDescriptor` 与 Catalog 持久化
- 接入 Builtin/MCP 采集
- 输出冲突分析报告（duplicate/overlap/mutex）

### Phase 2（1-2 周）路由器替换

- 将 taskToolResolver 升级为 candidate resolver
- 加入评分与回退
- 增加路由可解释日志

### Phase 3（1-2 周）OpenCLI Provider

- 新增 OpenCLI Adapter + 管理工具
- 能力发现 + 执行 + 体检
- 与治理策略打通

### Phase 4（1-2 周）本机软件安全增强

- BinaryAccessGrant
- 参数模板校验
- TTY/GUI/Network 约束

## 11. 测试策略

新增测试维度：

- 冲突识别正确率：同义能力识别、误判率
- 路由稳定性：同输入跨会话选择一致性
- 回退有效性：主执行失败后可回退
- 安全性：未授权二进制/参数必须拒绝
- OpenCLI 集成：list/doctor/exec 失败路径与恢复

## 12. 迁移与兼容

- 保持旧工具名可用（兼容层），内部映射到 capabilityId。
- 初期灰度：仅对部分任务启用新 resolver，可快速回滚。
- 记录新旧 resolver 决策差异用于评估上线风险。

## 13. 关键社区实践对齐（采纳点）

本设计采纳的实践：

- 工具需清晰 schema 与描述，减少歧义调用。
- 高风险工具必须审批/allowlist，而不是仅靠 prompt。
- 大量工具场景使用按需加载（defer loading）避免上下文膨胀。
- 对 shell/CLI 执行采用严格策略边界与显式授权。

## 14. 验收标准（Done Definition）

满足以下条件视为“CLI 支撑体系完成第一阶段可用”：

- 能输出统一能力目录并标注冲突关系。
- CLI/MCP/Builtin 不再按“同名直接覆盖”。
- OpenCLI 至少支持 `doctor/list/exec` 三类能力并纳入治理。
- 本机软件调用具备二进制级授权与审计。
- 核心流程有自动化测试覆盖。

## 15. 参考

- MCP Tools 规范：<https://modelcontextprotocol.io/specification/2025-06-18/server/tools>
- MCP 架构：<https://modelcontextprotocol.io/specification/2025-03-26/architecture/index>
- OpenAI MCP Connectors 指南：<https://developers.openai.com/api/docs/guides/tools-connectors-mcp>
- OpenAI Local Shell 指南：<https://developers.openai.com/api/docs/guides/tools-local-shell>
- OpenAI Agents Tools 指南：<https://openai.github.io/openai-agents-js/guides/tools/>
- Anthropic Tool Use 实践：<https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use>
- Claude Code Security：<https://code.claude.com/docs/en/security>
- OpenCLI 仓库：<https://github.com/jackwener/opencli>
- OpenCLI 规范提案：<https://opencli.org/>

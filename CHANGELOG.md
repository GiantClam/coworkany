# Changelog

本文档记录 CoworkAny 的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

### Added - 新增功能

#### 🎯 Package Manager 自动检测
- **6级优先级检测机制**
  - 环境变量 → 项目配置 → package.json → Lock文件 → 全局配置 → 系统检测
- **支持的包管理器**: npm, pnpm, yarn, bun
- **自动生成命令**: 根据检测结果生成 install/test/build/dev 命令
- **用户偏好保存**: 支持项目级和全局级配置
- **实现位置**: `sidecar/src/utils/packageManagerDetector.ts`
- **灵感来源**: [everything-claude-code](https://github.com/affaan-m/everything-claude-code)

#### ✅ 代码质量检测 Hooks
- **Console.log 检测**
  - 自动扫描 `.js/.jsx/.ts/.tsx` 文件中的调试语句
  - 排除注释中的 console 调用
  - 显示具体行号和内容
  - 提供清理建议
- **TypeScript 类型验证**
  - 编辑 TypeScript 文件后自动运行 `tsc --noEmit`
  - 解析并显示类型错误
  - 限制显示前 10 个错误，避免信息过载
- **Prettier 格式检查**
  - 检测文件是否符合 Prettier 规范
  - 提供格式化命令建议
  - 支持 .js/.jsx/.ts/.tsx/.json/.css/.scss/.md 等文件
- **实时反馈**: 在效果确认对话框中显示所有检查结果
- **实现位置**: `sidecar/src/hooks/codeQualityHooks.ts`
- **灵感来源**: [everything-claude-code hooks](https://github.com/affaan-m/everything-claude-code/blob/main/hooks/hooks.json)

#### 📦 MCP 服务器配置模板
- **9个预置模板**:
  - **开发工具**: GitHub, Filesystem, Puppeteer
  - **数据库**: Supabase, PostgreSQL
  - **部署平台**: Vercel, Railway
  - **其他服务**: Slack, Brave Search
- **完整设置说明**: 每个模板包含详细的配置步骤
- **环境变量管理**: 安全的 API Key 配置
- **模板转换**: 自动生成 MCP 配置
- **实现位置**: `sidecar/src/config/mcpTemplates.ts`
- **灵感来源**: [everything-claude-code mcp-configs](https://github.com/affaan-m/everything-claude-code/tree/main/mcp-configs)

#### 💾 Session Memory 持久化
- **会话记录**: 保存所有对话历史
- **学习能力**: 自动提取用户偏好和项目特征
- **模式识别**: 识别用户的重复行为和习惯
  - 使用置信度评分 (0-1)
  - 统计出现次数
  - 记录首次和最后出现时间
- **上下文恢复**: 新会话自动加载上次内容
- **智能清理**: 保留最近 10 个会话，自动清理旧数据
- **存储位置**: `<workspace>/.coworkany/memory/sessions/`
- **实现位置**: `sidecar/src/storage/sessionMemoryStore.ts`
- **灵感来源**: [everything-claude-code memory persistence](https://github.com/affaan-m/everything-claude-code/tree/main/hooks/memory-persistence)

#### 🗂️ 工作空间侧边栏重设计
- **层级结构**: Workspace → Sessions
- **可展开/折叠**: 每个工作空间可以展开查看所有会话
- **会话计数**: 显示每个工作空间的会话数量
- **内联创建**: 侧边栏内直接创建工作空间，无需单独页面
- **自动激活**: 新创建的工作空间自动设为活动状态
- **智能展开**: 活动工作空间自动展开
- **实现位置**: `desktop/src/components/Sidebar/Sidebar.tsx`

### Changed - 变更

#### 工作空间管理优化
- **payload 结构修复**: 统一 IPC 响应格式，修复 `data.payload.workspace` 访问
- **自动选择**: 创建工作空间后自动设为活动状态
- **智能删除**: 删除活动工作空间时自动切换到下一个可用工作空间
- **持久化**: 活动工作空间 ID 保存到 localStorage

#### 任务启动流程增强
- **Package Manager 注入**: 启动任务时自动检测并注入到上下文
- **Session Memory 集成**: 任务开始时加载上次会话上下文
- **增强上下文**: AI 获得更多项目环境信息

### Fixed - 修复

#### IPC 通信问题
- 修复 `create_workspace` 参数格式（从 `{input: {...}}` 改为直接参数）
- 修复 `delete_workspace` 参数格式
- 修复 `update_workspace` 参数格式
- 修复 `list_workspaces` 响应解析

#### 工作空间加载问题
- 修复工作空间列表不显示的问题
- 修复 "Workspace path is not available" 错误
- 添加 `loadedRef` 防止重复加载

### Documentation - 文档

#### 新增文档
- **README.md**: 完整的项目说明，包含所有功能介绍
- **docs/USER_GUIDE_CN.md**: 详细的中文用户指南
  - 快速上手教程
  - 各功能详细使用说明
  - 常见问题解答
  - 故障排查指南
- **CHANGELOG.md**: 本变更日志

#### 文档内容
- 技术架构说明
- 安装和配置指南
- 开发指南
- 代码示例
- 最佳实践

---

## [0.1.0] - 2026-01-XX (基础版本)

### Added - 初始功能

#### 核心功能
- **多工作空间管理**: 独立的项目环境
- **AI 对话**: 基于 Claude API 的智能助手
- **效果确认**: 代码变更前的用户确认机制
- **技能系统**: 从 GitHub 安装和管理技能
- **MCP 集成**: 多 MCP 服务器支持

#### 技术栈
- **前端**: React 18 + TypeScript + Vite
- **后端**: Rust + Tauri 2.0
- **Sidecar**: Bun Runtime + TypeScript
- **状态管理**: Zustand
- **Schema 验证**: Zod

#### 存储系统
- **WorkspaceStore**: 工作空间管理
- **SkillStore**: 技能管理
- **ToolpackStore**: 工具包管理

---

## 对比 everything-claude-code

CoworkAny 借鉴了 [everything-claude-code](https://github.com/affaan-m/everything-claude-code) 的优秀设计，但进行了架构调整以适应桌面应用场景：

| 功能 | everything-claude-code | CoworkAny | 说明 |
|------|----------------------|-----------|------|
| Package Manager 检测 | ✅ Shell脚本 | ✅ TypeScript | 完整移植，更好的类型安全 |
| Console.log 检测 | ✅ Hook | ✅ Hook | 完整移植 |
| TypeScript 验证 | ✅ Hook | ✅ Hook | 完整移植 |
| Prettier 检查 | ✅ Hook | ✅ Hook | 完整移植 |
| MCP 配置模板 | ✅ JSON配置 | ✅ TypeScript模板 | 增强的类型安全和文档 |
| Session Memory | ✅ Shell脚本 | ✅ TypeScript | 完整重写，增加模式识别 |
| Hooks 系统 | ✅ Shell | ✅ Native集成 | 集成到 IPC 流程 |
| Continuous Learning v2 | ✅ | 🔄 基础版 | 实现了模式提取和置信度 |
| Verification Loops | ✅ | ⏳ 计划中 | 待实现 |
| Agents | ✅ | ⏳ 计划中 | 待实现 |
| Skills创建工具 | ✅ | ⏳ 计划中 | 待实现 |

### 主要差异

**架构差异**:
- everything-claude-code: CLI 工具 + Shell hooks
- CoworkAny: 桌面应用 + Native TypeScript hooks

**优势**:
- ✅ 更好的类型安全
- ✅ GUI 界面，易于使用
- ✅ 原生集成，性能更好
- ✅ 跨平台支持（Windows/Mac/Linux）

**不足**:
- ⚠️ 缺少一些高级功能（Agents、Verification Loops）
- ⚠️ 需要安装桌面应用

---

## 未来计划

### 近期计划 (v0.2.0)
- [ ] 前端 UI 集成 MCP 模板选择器
- [ ] 效果确认对话框显示 Hook 警告
- [ ] 配置页面：启用/禁用单个 Hook
- [ ] Session Memory UI 展示
- [ ] 工作空间导入/导出

### 中期计划 (v0.3.0)
- [ ] Continuous Learning v2 完整实现
- [ ] 更多 MCP 服务器模板
- [ ] 技能自动更新
- [ ] 多语言支持
- [ ] 主题定制

### 长期计划 (v1.0.0)
- [ ] Agent 系统（委托专门任务）
- [ ] Verification Loops（验证循环）
- [ ] Skills 创建向导
- [ ] 云端同步
- [ ] 团队协作功能

---

## 贡献者

感谢所有为 CoworkAny 做出贡献的开发者！

特别感谢：
- [affaan-m](https://github.com/affaan-m) - everything-claude-code 项目作者，提供了许多优秀的设计思路

---

[Unreleased]: https://github.com/your-org/coworkany/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/coworkany/releases/tag/v0.1.0

# CoworkAny

企业级 AI 工作台，提供 AI 对话、Agent 对话、写作、图片生成、PPT、工作流和本地运行能力。

[English README](README_EN.md) · [0.1.1 发布说明](RELEASE_NOTES_0.1.1.md)

## 主要能力

- AI 对话与 Agent 对话：按入口隔离会话，支持流式回复、工具调用和过程信息折叠展示。
- 写作与多平台协作：使用 Markdown 正文渲染，并支持文章预览、复制和 artifact 展示。
- PPT 与媒体任务：通过已配置的 Provider 执行生成任务，并在消息中展示结果 artifact。
- 工作流：支持节点配置、运行状态、错误信息和任务结果的持久化。
- 桌面端：基于 Tauri 的 Windows 应用，支持本地运行时和绿色便携模式。

## 快速开始

### Web 开发环境

```bash
pnpm install
pnpm dev
```

默认开发地址为 `http://localhost:3000`。

### 桌面端开发环境

```bash
pnpm install
pnpm tauri:dev
```

桌面端开发服务器使用本地 Tauri 壳，并复用工作台 UI、Provider 和 skill 运行时。

## 构建 Windows 绿色版

项目版本号为 `0.1.1`。执行以下命令构建桌面端并生成绿色便携压缩包：

```bash
pnpm tauri:build
pnpm --filter @coworkany/desktop package:portable-zip
```

产物位于：

```text
.artifacts/desktop-release/CoworkAny-Windows-x64-portable.zip
```

绿色版不会要求安装器注册系统组件；运行时数据保存在可执行文件旁的 `data` 目录中，适合复制到其他 Windows 设备使用。

## 发布前校验

```bash
pnpm desktop:release:regression
pnpm desktop:verify-bundle
pnpm desktop:verify-network-boundary
pnpm desktop:verify-packages
pnpm desktop:verify-portable-copy
pnpm desktop:verify-path-matrix
pnpm desktop:release-audit
```

如果只需要验证工作台 UI：

```bash
pnpm --filter @coworkany/workbench-ui exec tsx --test test/workbench-message-surface.test.tsx
pnpm --filter @coworkany/workbench-ui typecheck
```

## 配置 Provider

Provider、模型和 API Key 应通过应用配置或环境变量提供。请勿把真实 API Key 写入仓库、README、测试文件或发布压缩包。

## 项目结构

| 路径 | 说明 |
| --- | --- |
| `app/`、`components/`、`lib/` | Web 应用与服务端逻辑 |
| `apps/desktop/` | Tauri 桌面端与本地运行时 |
| `packages/workbench-ui/` | Web 与桌面端共享的工作台 UI |
| `content/skills/` | Agent 与功能入口使用的 skill |
| `scripts/` | 构建、打包和发布校验脚本 |

## 许可证

当前仓库未声明公开许可证。使用、分发或修改前请确认项目所有者的授权范围。

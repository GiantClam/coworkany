# CoworkAny 0.1.1

## 中文

### 本次发布

0.1.1 基于 `coworkany/main` 的最新代码构建，继续完善 Windows 桌面端工作台体验：

- 工作流预览直接回到任务画布，并恢复对应任务的节点配置、运行状态和结果。
- 工作流节点参数与产物展示保持一致，减少从 Recent Runs、任务中心和画布之间切换时的信息丢失。
- 保留 AI 对话、Agent、写作、PPT、媒体和工作流入口的会话隔离、流式消息、工具调用折叠、Markdown 正文和 artifact 展示能力。
- 绿色桌面包继续采用主程序包与本地运行时包分离的方式，避免发布包重复携带大体积运行时。

### 下载

- `CoworkAny-Windows-x64-normal.zip`：标准绿色桌面包。
- `CoworkAny-Windows-x64-portable.zip`：便携绿色桌面包，可复制到其他 Windows 设备运行。
- `CoworkAny-Runtime-x64.zip`：独立本地运行时包，供桌面包按需安装或更新。

### 构建与校验

```bash
pnpm desktop:release:regression
pnpm tauri:build
pnpm --filter @coworkany/desktop package:zip
pnpm --filter @coworkany/desktop package:portable-zip
```

发布包未进行 Windows Authenticode 签名。首次运行可能需要 WebView2；桌面端会按 Tauri 配置使用 bootstrapper。Provider、模型和 API Key 仍需在本地配置，不包含在发布包中。

## English

### Highlights

CoworkAny 0.1.1 is built from the latest `coworkany/main` code and continues the Windows desktop workbench improvements:

- Workflow previews now open the task canvas directly and restore the selected run's node configuration, status, and results.
- Workflow parameter and artifact rendering stay aligned across Recent Runs, Task Center, and the canvas, reducing lost context when switching views.
- AI chat, agent, writing, presentation, media, and workflow entries retain entry-scoped sessions, streaming messages, collapsible tool calls, Markdown body rendering, and artifact display.
- The green desktop distribution keeps the application package separate from the local runtime package, avoiding duplicated large runtime payloads.

### Downloads

- `CoworkAny-Windows-x64-normal.zip`: standard green desktop package.
- `CoworkAny-Windows-x64-portable.zip`: portable green desktop package for copying to another Windows device.
- `CoworkAny-Runtime-x64.zip`: standalone local runtime package used for on-demand installation or updates.

### Build and verify

```bash
pnpm desktop:release:regression
pnpm tauri:build
pnpm --filter @coworkany/desktop package:zip
pnpm --filter @coworkany/desktop package:portable-zip
```

The release is not Authenticode-signed. WebView2 may be required on first launch; the desktop app uses the configured Tauri bootstrapper. Providers, models, and API keys must be configured locally and are not included in the release packages.

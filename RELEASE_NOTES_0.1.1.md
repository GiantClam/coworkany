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

本次没有重新发布 runtime。`0.1.1` 使用与 `0.1.0` 相同的运行时资产；需要运行时的用户请下载 [`v0.1.0` 中的 CoworkAny-Runtime-x64.zip](https://github.com/GiantClam/coworkany/releases/download/v0.1.0/CoworkAny-Runtime-x64.zip)。只有 Node、OpenCode、Python、字体、嵌入模型或 runtime manifest 发生变化时才会重新发布 runtime。

### 安装与运行

1. 下载本发布中的任一桌面 ZIP，并下载上方链接的 `CoworkAny-Runtime-x64.zip`。
2. 解压桌面 ZIP，将 Runtime ZIP 原样放在 `CoworkAny.exe` 旁边。
3. 双击 `CoworkAny.exe`；首次启动会自动校验并安装 Runtime。

普通版的 Runtime 数据目录为 `%LOCALAPPDATA%\CoworkAny`；便携版（含 `portable.flag`）的 Runtime 数据目录为 exe 旁的 `data\`。如果 Runtime ZIP 不在 exe 旁，可在“设置 → 运行环境与诊断”填写绝对路径并点击“导入离线运行时”。不要手动解压 Runtime ZIP，也不要改变桌面包目录结构。

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

The runtime was not republished for this release. `0.1.1` uses the same runtime assets as `0.1.0`; users who need the runtime should download [`CoworkAny-Runtime-x64.zip` from `v0.1.0`](https://github.com/GiantClam/coworkany/releases/download/v0.1.0/CoworkAny-Runtime-x64.zip). A new runtime release is needed only when Node, OpenCode, Python, fonts, the embedding model, or the runtime manifest changes.

### Install and run

1. Download either desktop ZIP from this release and download `CoworkAny-Runtime-x64.zip` from the link above.
2. Extract the desktop ZIP and place the Runtime ZIP unchanged beside `CoworkAny.exe`.
3. Double-click `CoworkAny.exe`; the first launch validates and installs the Runtime automatically.

The normal package stores Runtime data under `%LOCALAPPDATA%\CoworkAny`; the portable package (with `portable.flag`) stores it under `data\` beside the executable. If the Runtime ZIP is not beside the executable, enter its absolute path under `Settings → Runtime & diagnostics` and select `Import offline runtime`. Do not extract the Runtime ZIP manually or change the desktop package layout.

### Build and verify

```bash
pnpm desktop:release:regression
pnpm tauri:build
pnpm --filter @coworkany/desktop package:zip
pnpm --filter @coworkany/desktop package:portable-zip
```

The release is not Authenticode-signed. WebView2 may be required on first launch; the desktop app uses the configured Tauri bootstrapper. Providers, models, and API keys must be configured locally and are not included in the release packages.

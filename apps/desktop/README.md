# CoworkAny Windows Desktop

本目录是 Windows 绿色版的唯一桌面入口：React/Vite UI 由 Tauri 2 承载，Rust 负责 SQLite 和本地路径，Node workflow-host 负责 OpenCode framed RPC。桌面包不引入线上登录、企业、计费、R2、Railway 或云端任务服务。

## 本机验证

```powershell
pnpm install
pnpm --filter @coworkany/desktop typecheck
pnpm --filter @coworkany/desktop test
pnpm --filter @coworkany/desktop build
pnpm --filter @coworkany/desktop exec tauri build --bundles nsis
pnpm --filter @coworkany/desktop package:zip
pnpm --filter @coworkany/desktop package:portable-zip
```

NSIS 产物位于 `apps/desktop/src-tauri/target/release/bundle/nsis/`；当前未签名 NSIS 产物为 180,130,496 bytes。绿色 ZIP 位于 `.artifacts/desktop-release/`，当前普通包为 269,787,833 bytes、便携包为 269,851,589 bytes；便携包已内置 `portable.flag`。Python/PPT 依赖仍由首启镜像链安装。运行时数据默认写入 `%LOCALAPPDATA%\CoworkAny`；便携包使用 exe 旁的 `data/`。MSI 需要本机安装并可用 WiX `light.exe`，NSIS 不依赖该可选步骤。最终 hash、签名状态和完整发布矩阵以 [`docs/desktop/windows-v1-release-checklist.zh-CN.md`](../../docs/desktop/windows-v1-release-checklist.zh-CN.md) 为准。

当前已接通：本地配置原子恢复、单实例锁、Rust SQLite 基础 schema 与 typed repository、OpenCode Host framed RPC（普通对话/写作/工作流文本统一走 OpenCode 且复用稳定 session）、本地文件 artifact、Obsidian Markdown manifest/关键词检索/reconciliation/冲突保护写入/扫描重建、共享 workflow/writer/skill/media contracts、工作流能力选择、OpenAI-compatible/Bailian/MiniMax/RunningHub 直连 submit/poll 与媒体下载、Windows Job Object 进程监管；桌面 UI 复用了线上 dashboard 的路由命名与导航顺序（`/dashboard`、`/dashboard/ai`、`/dashboard/writer`、`/dashboard/image-assistant`、`/dashboard/workflows`、`/dashboard/tasks`、`/dashboard/assets`、`/dashboard/knowledge-base`、`/dashboard/video`、`/dashboard/settings` 等），通过 `@coworkany/workbench-ui` 共享线上主题 token、字体栈、首页入口文案、消息框架和工作区 archetype。构建时固定拉取官方 `hugohe3/ppt-master` commit 并复制完整 Skill（缺失时优先本地 spike 缓存，否则自动 git 获取），桌面只移除已确认排除的登录、企业、计费、Lead Hunter、公开营销页面与发布为 Agent，其余入口使用同一文案和路由语义；本地运行时、配置和数据适配由 Tauri/Rust/Node 完成。

## 多 Provider 配置

桌面运行时兼容旧版单 `provider` 配置，并支持按能力选择独立 Provider profile。普通模式配置位于 `%LOCALAPPDATA%\\CoworkAny\\config.json`，绿色便携模式位于程序目录 `data\\config.json`。`provider` 是兼容回退项；`providers` 的键是 profile ID，`defaults` 将 `text`、`image`、`video`、`audio` 分别绑定到 profile：

```json
{
  "schemaVersion": 1,
  "workspacePath": "D:\\CoworkAny Workspace",
  "provider": {
    "id": "text-main",
    "source": "openai-compatible",
    "model": "gpt-6.1-sol",
    "baseUrl": "https://text.example/v1",
    "apiKey": "text-secret"
  },
  "providers": {
    "text-main": {
      "id": "text-main",
      "model": "gpt-6.1-sol",
      "baseUrl": "https://text.example/v1",
      "apiKey": "text-secret"
    },
    "image-main": {
      "id": "image-main",
      "model": "gpt-image-2-1k",
      "baseUrl": "https://image.example/v1",
      "apiKey": "image-secret"
    },
    "video-minimax-h3": {
      "id": "video-minimax-h3",
      "source": "runninghub",
      "model": "MiniMax-Hailuo-H3",
      "baseUrl": "https://www.runninghub.cn",
      "apiKey": "runninghub-secret",
      "endpoint": "/openapi/v2/minimax/hailuo-h3/multimodal-to-video",
      "queryEndpoint": "/openapi/v2/query"
    },
    "video-runninghub-seedance": {
      "id": "video-runninghub-seedance",
      "source": "runninghub",
      "model": "seedance",
      "baseUrl": "https://www.runninghub.cn",
      "apiKey": "runninghub-secret",
      "endpoint": "/openapi/v2/rhart-video/sparkvideo-2.0-fast/text-to-video",
      "queryEndpoint": "/openapi/v2/query"
    },
    "audio-minimax": {
      "id": "audio-minimax",
      "source": "minimax",
      "model": "MiniMax-Hailuo",
      "baseUrl": "https://api.minimaxi.com/v1",
      "apiKey": "minimax-secret"
    }
  },
  "defaults": {
    "text": "text-main",
    "image": "image-main",
    "video": "video-minimax-h3",
    "audio": "audio-minimax"
  },
  "runtime": { "source": "system" }
}
```

未配置或找不到默认 profile 时，会安全回退到旧版 `provider`。工作流节点如果显式携带 `provider`，Host 会从同一组 profiles 解析该节点的 Base URL、API Key、Endpoint 和模型。

RunningHub 的工作流是账号私有资源，API Key 只对该账号有权限的 workflow 生效。请在自己的 RunningHub 账号中复制或创建工作流，然后在设置页的 RunningHub Provider 中通过“账号工作流注册”导入 workflow ID/链接和 ComfyUI API JSON。旧版 `workflowId`、`digitalHumanWorkflowId`、`videoEnhanceWorkflowId` 会在首次启动时自动转换为可编辑的 `workflows[]` 注册项；不要把他人工作流链接写入共享 workflow JSON。运行时缺少当前账号 workflow 或收到 401/403/404 时会直接提示访问权限错误。

LanceDB 使用动态加载：主绿色包不携带约 283 MiB 的平台原生 `.node`。索引默认使用随应用提供的离线 `local-hash-384-v1` 特征哈希向量（无需网络），若用户显式配置 loopback Ollama `nomic-embed-text` 则使用真实本地模型；两者都只写入每 Vault 独立 LanceDB，SQLite 永不保存 chunk、向量或 Vault 原文。

## 工作流可移植边界

工作流通过普通 `.workflow.json` 文件共享。导出内容不包含 API Key、Provider/模型绑定、数据库内部 ID、运行历史或绝对本机路径；在另一台机器导入时会迁移 schema、生成新的本地 workflow ID，并使用该机当前 Provider、项目目录、Vault 和索引路径。`app.db` 与每个 Vault 的 LanceDB 都是单机状态，不支持通过同步盘共享或并发打开；第二个实例会被单实例锁拒绝。

真实 Provider 默认 smoke 使用 LLM/image/audio，并按验收要求排除 Seedance；图片 Provider 也可用 `pnpm --filter @coworkany/desktop test:real-providers:image` 单独复验，默认优先请求低分辨率 `256x256`，需要时可用 `COWORKANY_PROVIDER_IMAGE_SIZE=512x512` 或其他受支持尺寸覆盖；当 image profile 是 PPTOKEN 时，该 smoke 也会固定发送 `gpt-image-2`，不会跟随上游目录中的其他模型。PPTOKEN 专用连通性 smoke 使用 `pnpm test:pptoken-image-connectivity`，固定只验证 `gpt-image-2`，默认请求 `256x256`，不会遍历上游列出的其他图片模型。当前 PPTOKEN 配置的 `/images/generations` 若返回 502，命令会在 3 次有界重试后 fail-closed，不会伪报成功。音频-only smoke 可用 `COWORKANY_PROVIDER_AUDIO_POLLS`（默认有界预算，最多 240 次）和 `COWORKANY_PROVIDER_AUDIO_POLL_DELAY_MS` 调整诊断轮询；不会无限等待。音乐-only smoke 使用 `pnpm --filter @coworkany/desktop test:real-providers:music` 验证 MiniMax `/music_generation` 的 URL 音频 schema。当配置包含非 Seedance 视频 profile（例如上例的 RunningHub MiniMax-H3）时，可运行 `pnpm --filter @coworkany/desktop test:real-providers:video` 验证真实视频提交、轮询与结果 schema。没有非 Seedance profile 时该命令会在发起任何 Provider 请求前 fail-closed。

当前已完成真实 OpenCode + 固定版本官方 `ppt-master` 的本地端到端产物验证（中文、图片、16:9、可编辑文本、PowerPoint 渲染）；仍需后续验收的是真实签名发布、首启原生安装门禁/干净 Win10/Win11 矩阵、生产 Writer runtime/R2 smoke，以及完整 Workbench streaming UI 的视觉和线上 parity fixtures。当前未将这些外部门禁误标为 v1 已完成。

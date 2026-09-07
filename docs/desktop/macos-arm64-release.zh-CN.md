# macOS Apple Silicon 发布说明

本文档定义 CoworkAny 桌面端的首个 macOS 发布 profile：`macOS 12+`、`Apple Silicon（arm64）`、官网分发的签名 DMG 和便携 ZIP。不包含 Intel Mac、Mac App Store 和自动更新。

## 一套代码、两套平台资源

桌面 UI、配置、工作流和本地 Host 继续复用同一套 TypeScript/Rust 代码。平台差异集中在 `runtime/platform.ts` 和 `src-tauri/src/platform.rs`：Windows 使用 `.exe` 与 `%LOCALAPPDATA%`，macOS 使用 Unix 可执行文件与 `~/Library/Application Support/CoworkAny`。

macOS 的运行时必须在签名之前放进 `CoworkAny.app` 资源目录；应用运行时不会下载或替换其可执行文件。这样签名、Gatekeeper 和公证的完整性边界不会被破坏。

## 构建前提

在 Apple Silicon Mac 上安装 Xcode Command Line Tools、Rust、Node.js 和 pnpm，然后执行：

```bash
pnpm install --frozen-lockfile
export COWORKANY_MAC_NODE_RUNTIME_DIR="/path/to/prepared/node-runtime"
export COWORKANY_MAC_OPENCODE_RUNTIME_DIR="/path/to/prepared/opencode-runtime"
export COWORKANY_MAC_PYTHON_RUNTIME_DIR="/path/to/prepared/python-runtime"
export COWORKANY_MAC_FONT_PATH="/path/to/NotoSansCJKsc-Regular.otf"
pnpm desktop:macos:build
```

`build:runtime:macos` 会拒绝在非 Darwin arm64 主机执行，并验证 LanceDB 的 `@lancedb/lancedb-darwin-arm64` 原生模块。三个 runtime 目录必须分别直接包含 `node`、`opencode` 和 `python3`，且包含它们所需的动态库、标准库与资源；不能只复制系统上的单个可执行文件。请只提供已获许可、可随产品再分发且已通过 macOS 签名校验的资源。

## 签名、公证与发布

构建命令产出 `.app` 和 `.dmg`。发布前在干净的 Apple Silicon 测试机完成以下步骤：

1. 使用 Developer ID Application 证书签名 `.app` 内所有嵌套可执行文件、Framework 与主应用；不允许事后写入 app bundle。
2. 用 `codesign --verify --deep --strict --verbose=2 CoworkAny.app` 验证签名。
3. 提交 DMG 或 ZIP 到 Apple notarization，等待成功后 stapler 装订票据。
4. 在无开发环境的新用户帐户中验证首次启动、工作流、知识库、退出后子进程清理与 Gatekeeper。

证书标识、notary 凭据和任何 API Key 只能从 CI 密钥管理或本机钥匙串读取，不能写入仓库或应用配置。

## 便携 ZIP

在签名和公证完成的 `.app` 上运行：

```bash
pnpm desktop:macos:portable
```

产物结构如下，`CoworkAny Data` 位于 `.app` 外部，因此用户数据变动不会使签名失效：

```text
CoworkAny-macOS-arm64-portable/
├── CoworkAny.app
├── CoworkAny Data/
└── portable.flag
```

便携版移动文件夹后会恢复包内默认工作区；用户显式选择的外部工作区不会被改写。首次运行仍可能受到 Gatekeeper 隔离属性影响，应从已公证的 DMG/ZIP 分发，不应指导用户绕过系统安全提示。

## 本地验证命令

```bash
pnpm desktop:typecheck
pnpm desktop:test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm desktop:macos:build
pnpm desktop:macos:portable
```

Windows 发布仍使用原有 `pnpm tauri:build` 和 PowerShell 打包脚本；两条发布链路共享功能代码，但各自打入并校验对应平台的二进制资源。

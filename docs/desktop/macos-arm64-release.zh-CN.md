# 桌面端 Release 发布机制

桌面端通过 [.github/workflows/desktop-release.yml](../../.github/workflows/desktop-release.yml) 发布。推送 `vX.Y.Z` tag 后，GitHub Actions 会并行构建 Windows x64（`windows-2022`）和 macOS Apple Silicon（`macos-15`、arm64），两端成功后创建或恢复 GitHub Draft Release。也可以用 `workflow_dispatch` 输入一个已有 tag 重试；已公开的 Release 不会被覆盖。

macOS profile 为 `macOS 12+`、Apple Silicon（arm64）、官网分发的签名并公证 DMG 和便携 ZIP。不包含 Intel Mac、Mac App Store、自动更新或本轮新增的 Windows Authenticode 签名。Windows 保留现有安装器、ZIP 和独立 Runtime 策略。

## 发布流程

1. 在准备发布的 commit 上同步五处版本号：`package.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/tauri.conf.json`、`apps/desktop/src-tauri/Cargo.toml` 和 `apps/desktop/src-tauri/Cargo.lock`。
2. 用版本脚本更新并检查版本。`--set` 接受不带 `v` 的 SemVer；`--check` 接受带 `v` 的 tag：

   ```bash
   pnpm desktop:release:version --set 0.1.3
   pnpm desktop:release:version --check v0.1.3
   ```

3. 提交版本变更，再创建并推送 tag：

   ```bash
   git add package.json apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
   git commit -m "Prepare CoworkAny 0.1.3 release"
   git tag -a v0.1.3 -m "CoworkAny 0.1.3"
   git push --atomic origin main v0.1.3
   ```

   首次启用发布机制时，必须先把包含 workflow 和脚本的 commit 合入默认分支，再推送版本 tag。预发布版本可使用 `v0.1.3-beta.1` 等 SemVer tag；Windows NSIS 的版本约束仍以 CI 实际结果为准。
4. `version` job 验证不可变 tag 指向当前 commit、五处版本一致，并运行发布元数据与产物门禁。Windows job 运行桌面类型检查、release tests、Rust tests、Tauri 构建及普通/便携 ZIP 打包。
5. macOS job 只在 arm64 runner 上运行：下载固定 URL 和 SHA-256 的批准版离线 Runtime，校验后把完整 Runtime 放入 `.app`，再签名、公证、staple 并生成 DMG 与便携 ZIP。
6. `release` job 只有在两端成功后才整理产物、生成 `SHA256SUMS` 和 `release-manifest.json`，并上传到 Draft Release。维护者必须在干净 macOS 和 Windows 机器完成人工验证，再在 GitHub 中发布草稿。

发布后不能复用同一个已公开 tag 或覆盖已公开 Release；修复必须递增版本并创建新 tag。

## macOS CI 配置

在仓库 Settings → Secrets and variables → Actions 中配置以下一次性 secrets。CI 不从仓库文件读取证书或凭据：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Secret | `APPLE_CERTIFICATE` | Developer ID Application `.p12` 的 base64 内容 |
| Secret | `APPLE_CERTIFICATE_PASSWORD` | `.p12` 密码 |
| Secret | `APPLE_SIGNING_IDENTITY` | Developer ID Application 证书身份 |
| Secret | `APPLE_ID` | Apple notarization 账号 |
| Secret | `APPLE_PASSWORD` | Apple app-specific password |
| Secret | `APPLE_TEAM_ID` | Apple Team ID |

同时配置以下 repository variables。Runtime 地址必须是 HTTPS 的固定 tar.gz 地址，SHA-256 必须是对应归档的固定 digest：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `COWORKANY_MAC_RUNTIME_URL` | 批准版 macOS arm64 Runtime tar.gz 地址 |
| Variable | `COWORKANY_MAC_RUNTIME_SHA256` | 64 位十六进制 SHA-256 |

Runtime 归档根目录必须包含以下文件，并在 `node`、`opencode`、`python` 目录中带齐所需 dylib、标准库和资源：

```text
node/node
opencode/opencode
python/python3
fonts/NotoSansCJKsc-Regular.otf
LICENSES.txt
```

Runtime 必须允许随产品再分发、兼容 macOS 12+ 和 arm64，不能包含 API key。CI 固定使用 URL 与 digest 指向的批准版 Runtime，避免下载 `latest` 造成不可复现构建；不能只提供系统单文件可执行程序。

## 产物与人工发布门禁

Draft Release 应包含以下五个桌面产物，以及两个校验文件：

```text
CoworkAny_<version>_x64-setup.exe
CoworkAny-Windows-x64-normal.zip
CoworkAny-Windows-x64-portable.zip
CoworkAny-<version>-macOS-arm64.dmg
CoworkAny-macOS-arm64-portable.zip
SHA256SUMS
release-manifest.json
```

发布者在 Draft Release 页面下载并检查两平台产物：Windows 安装器/ZIP 能启动并完成基本功能；macOS 在干净 Apple Silicon 机器上通过 Gatekeeper、首次启动、离线 Runtime、首页、工作流、知识库、退出后子进程清理和便携目录验证。确认 `SHA256SUMS` 后再点击 Publish release。

macOS 签名和公证流程参考 [Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html) 与 [notarytool 文档](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)，GitHub Actions 运行机制参考 [GitHub Actions 文档](https://docs.github.com/en/actions)。本机制目前没有自动更新和 Intel 版本。

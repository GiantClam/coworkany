# 桌面端 Windows/macOS 共用代码整改计划

## 目标

在保留 Windows NSIS 与便携 ZIP 发布能力的前提下，用同一套桌面端业务代码支持 macOS Apple Silicon 的 DMG 和便携 ZIP 发布。首期不承诺 Intel Mac、Universal Binary 或 Mac App Store。

## 改造边界

1. 将运行时目标、可执行文件名和数据目录归入平台适配层，消除业务层中的 Windows 文件名假设。
2. 将 Rust 的 Windows API 调用限制在 `cfg(windows)`，为 macOS 提供可用的进程查找、单实例与子进程清理实现。
3. 将 Windows PowerShell 运行时打包链保留为 Windows 专属入口，并增加 Node 驱动的 macOS arm64 运行时打包、DMG 与便携 ZIP 入口。
4. 增加 Tauri macOS 覆盖配置、ICNS 图标以及签名/公证所需的构建接口；不在仓库保存任何证书或 Apple 凭据。

## 验收

- Windows 既有类型检查与桌面测试继续通过。
- macOS 构建配置能生成 `.app` / `.dmg` 的构建命令，并使用 macOS arm64 运行时清单。
- 共享测试覆盖目标描述、可执行文件名、便携目录和 macOS 运行时 staging。
- Rust 非 Windows 编译路径不再引用 `std::os::windows` 或 Windows-only 进程命令。

## 风险与后续项

- 必须在 Apple Silicon macOS runner 上完成真实签名、公证和端到端验证。
- 当前 LanceDB 锁定版本仅提供 Darwin arm64 原生资产；Intel Mac 支持需单独评估依赖升级或降级方案。
- 已签名 app bundle 不可在首启时写入或下载可执行运行时；macOS 发行物必须随包提供完整运行时。

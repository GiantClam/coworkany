# CoworkAny Release 授权说明

本说明随正式 Release 发布。它说明构建来源和随包内容的授权边界，不替代项目所有者、第三方组件或服务提供商的完整许可条款。

## CoworkAny 本体

当前仓库未声明公开开源许可证。下载或运行 CoworkAny Release 不自动授予修改、再分发、再许可或商业使用权；需要这些权限时，请先取得项目所有者的明确书面授权。

## macOS 产物

正式 macOS DMG 和便携 ZIP 必须来自 GitHub Actions 的正式 Release，使用 Developer ID Application 签名并完成 Apple 公证。没有 Developer ID 的内部测试 ZIP 可以挂在明确标注的内测 Draft/Prerelease 页面上，只用于受控测试，不构成对外分发授权。

## 随包 Runtime 与第三方内容

macOS 产物包含离线 Runtime。Runtime 内的 Node.js、Python、OpenCode、LanceDB 及其他第三方组件，分别受其上游许可证约束；对应许可证和版权信息随 Runtime 的 `LICENSES.txt` 提供。使用者还必须遵守所调用模型、Provider、字体和内置技能的服务条款与许可证。

## 发布前确认

发布者应在 Draft Release 阶段确认：

1. Release 对应的 tag、commit 和 `release-manifest.json` 一致。
2. `SHA256SUMS` 校验通过，且产物来自本次构建。
3. Runtime 的 `LICENSES.txt` 已随包提供，且 Runtime 来源允许再分发。
4. 任何额外的商业、品牌、内容或第三方授权已单独取得并留档。

# 客户定制便携包设计

## 目标

生成一个 macOS Apple Silicon 客户便携 ZIP。客户解压后无需配置 Provider，且工作流目录仅包含 `导入 · 工作流`。

## 输入

- 应用：当前仓库已构建的 macOS arm64 `CoworkAny.app`。
- Provider：本机 CoworkAny `config.json` 中现有的全部 Provider、能力默认值和 API Key。
- 工作流：本机 CoworkAny `app.db` 中名称严格等于 `导入 · 工作流` 的最新记录。

## 包内容

产物名为 `CoworkAny-macOS-arm64-customer-portable.zip`，解压后包含：

- `CoworkAny.app`
- `portable.flag`
- `CoworkAny Data/config.json`
- `CoworkAny Data/app.db`
- `README.txt`

`config.json` 保留 Provider 配置，但将工作区路径改为便携目录，将 Runtime 配置重置为随包探测模式，避免携带开发机绝对路径。

`app.db` 使用干净数据库结构，仅写入 `导入 · 工作流` 及其必要修订记录。不得复制会话、消息、运行记录、产物、项目、知识库映射或日志。

## 安全边界

客户包按用户明确授权包含现有 API Key。`README.txt` 必须说明凭据为明文敏感信息，禁止公开上传或转发。构建日志、清单和终端输出不得打印 API Key。

## 验证

- ZIP 可正常解压，目录结构完整。
- `.app` 通过 ad hoc 深度签名校验。
- `config.json` 可解析，8 个 Provider 均存在且 API Key 非空，默认能力绑定有效。
- `app.db` 通过 SQLite `quick_check`。
- `workflows` 表恰好一条记录，名称为 `导入 · 工作流`。
- 会话、消息、运行、产物和项目表均为空。
- 配置中不存在开发机工作区或 Runtime 绝对路径。
- 生成 SHA-256 校验文件。


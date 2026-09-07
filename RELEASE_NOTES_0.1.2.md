# CoworkAny 0.1.2

## 中文

### 本次发布

0.1.2 修复桌面端视频工作流在不同 Provider 下首帧、尾帧和参考媒体处理不一致的问题：

- DashScope Wan 3 正确支持首帧、尾帧、参考图片、参考视频和参考音频。
- 本地视频和音频会通过 DashScope 临时 OSS 上传流程转换为 Provider 可用的媒体引用。
- RunningHub MiniMax H3 正确将首帧和附加图片映射到 `imageUrls`，并将参考视频、参考音频映射到 `videoUrls`、`audioUrls`。
- RunningHub 本地媒体先上传再提交，避免把本机路径直接发送给 Provider。
- 对 Provider 不支持的媒体角色和超出数量限制的输入进行明确校验，避免静默丢失首帧或参考媒体。
- 增加媒体输入归一化、Provider 能力和适配器回归测试。

### 下载

- `CoworkAny-Windows-x64-normal.zip`：标准绿色桌面包。
- `CoworkAny-Windows-x64-portable.zip`：便携绿色桌面包。

本次不重新发布 Runtime。Runtime 与 `0.1.0`、`0.1.1` 相同，请继续使用 [`v0.1.0` 中的 CoworkAny-Runtime-x64.zip](https://github.com/GiantClam/coworkany/releases/download/v0.1.0/CoworkAny-Runtime-x64.zip)。只有 Node、OpenCode、Python、字体、嵌入模型或 Runtime manifest 发生变化时才重新发布 Runtime。

### 安装与运行

1. 下载本 Release 中的桌面 ZIP，并下载上方链接的 Runtime ZIP。
2. 解压桌面 ZIP，将 Runtime ZIP 原样放在 `CoworkAny.exe` 旁边。
3. 双击 `CoworkAny.exe`；首次启动会校验并安装 Runtime。

普通版将运行时数据写入 `%LOCALAPPDATA%\\CoworkAny`；便携版将数据写入 exe 旁的 `data\\`。不要手动解压 Runtime ZIP，也不要修改桌面包目录结构。Provider、模型和 API Key 需要在本地设置，不包含在发布包中。

### 校验状态

- 桌面端 TypeScript 类型检查通过。
- 媒体输入与能力测试：23/23 通过。
- Provider 适配器测试：42/42 通过。
- 并发 host session 隔离测试：14/14 通过。
- 发布前 lint 和 Web 构建通过。

本 Release 未进行 Windows Authenticode 签名。首次运行可能需要 WebView2。

## English

### Highlights

CoworkAny 0.1.2 fixes inconsistent first-frame, last-frame, and reference-media handling across desktop video providers:

- DashScope Wan 3 now handles first frame, last frame, reference images, reference videos, and reference audio correctly.
- Local video and audio files use DashScope's temporary OSS upload flow before synthesis.
- RunningHub MiniMax H3 maps the first frame and additional images to `imageUrls`, and reference video/audio to `videoUrls` and `audioUrls`.
- Local RunningHub media is uploaded before submission instead of sending local filesystem paths to the provider.
- Unsupported media roles and provider-specific limits are validated explicitly, preventing silent loss of frame or reference inputs.
- Added regression coverage for media normalization, provider capabilities, and adapter request payloads.

### Downloads

- `CoworkAny-Windows-x64-normal.zip`: standard green desktop package.
- `CoworkAny-Windows-x64-portable.zip`: portable green desktop package.

The Runtime is not republished in this release. It remains compatible with the Runtime from `0.1.0` and `0.1.1`; continue using [`CoworkAny-Runtime-x64.zip` from `v0.1.0`](https://github.com/GiantClam/coworkany/releases/download/v0.1.0/CoworkAny-Runtime-x64.zip). Publish a new Runtime only when Node, OpenCode, Python, fonts, the embedding model, or the Runtime manifest changes.

### Install and run

1. Download a desktop ZIP from this Release and download the Runtime ZIP from the link above.
2. Extract the desktop ZIP and place the Runtime ZIP unchanged beside `CoworkAny.exe`.
3. Double-click `CoworkAny.exe`; the first launch validates and installs the Runtime.

The normal package stores runtime data under `%LOCALAPPDATA%\\CoworkAny`; the portable package stores data under `data\\` beside the executable. Do not manually extract the Runtime ZIP or change the desktop package layout. Providers, models, and API keys must be configured locally and are not included in the release package.

### Verification

- Desktop TypeScript typecheck passed.
- Media input and capability tests: 23/23 passed.
- Provider adapter tests: 42/42 passed.
- Isolated concurrent host-session tests: 14/14 passed.
- Release pre-push lint and Web build passed.

The release is not Authenticode-signed. WebView2 may be required on first launch.

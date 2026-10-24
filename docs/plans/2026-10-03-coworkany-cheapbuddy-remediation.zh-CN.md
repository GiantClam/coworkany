# Coworkany 整改方案：CheapBuddy 默认 Provider 与账号、套餐接入

日期：2026-10-03
更新日期：2026-10-13
版本：4，保留原方案并按已实现代码与最终证据校准。
状态：W1–W7 代码已实现，功能回归及 Host/UI 构建通过；真实媒体、支付、跨平台凭据及发布网络 gate 尚未完成。
配套文档：[cheapbuddy.cc 整改方案](2026-10-03-cheapbuddy-remediation.zh-CN.md)

本轮未部署 CheapBuddy，也未生成新的原生发布安装包。交付范围和验证证据见 [2026-10-13 报告](../../.artifacts/cheapbuddy-implementation-20261013/README.md)与[实现计划](2026-10-13-cheapbuddy-implementation.md)。

## 1. 用户结果与接入边界

- 新安装将 CheapBuddy 设为默认 Provider；用户仍可选择其他 Provider。
- 使用 CheapBuddy 账号登录后，自动取得 Key、模型目录并完成配置，无需手填 URL、Key 或模型 ID。
- 未登录展示登录和官网购买入口；登录后通过现有用户接口展示套餐，购买后刷新余额和会员。
- 文本、图片和视频共用一个 CheapBuddy Provider 和一个 API Key；能力之间可以选择不同模型。

CheapBuddy 品牌、Base URL、官网购买入口和推荐文本模型候选直接内置；本次零新增公共接口。账号及商品操作复用既有用户 API，推理使用 Relay，购买在官网完成。账号与钱包属于 CheapBuddy，不绑定为 Coworkany 自有订阅。

## 2. 数据流与接口使用

```text
桌面账号与套餐 UI
  ├─ 内置 Provider 常量 → 品牌、固定地址、推荐模型候选
  ├─ 本地 Host 账号服务 → cheapbuddy.cc/api/v1 → 登录、Key、余额、会员、商品
  └─ 系统浏览器 → CheapBuddy 官网 → 登录、订单、付款

本地 Host 模型执行 → 同一 CheapBuddy Key → api.cheapbuddy.cc/v1 Relay
                                              ├─ 文本 → Sub2API
                                              └─ 图片/视频 → NewAPI
                                                   会员与计费 → Sub2API
```

已新增 `apps/desktop/src/cheapbuddy.ts`，集中维护以下内置常量及单一 Provider 的创建/合并规则。非秘密账号 DTO 位于 `src/cheapbuddy-contract.ts`，既有商品映射位于 Host 账号服务。其他 TS 模块导入这些常量；Rust 初始值有一致性回归检查。

```typescript
export const CHEAPBUDDY = {
  id: "cheapbuddy",
  name: "CheapBuddy",
  apiBaseUrl: "https://api.cheapbuddy.cc/v1",
  accountApiBaseUrl: "https://cheapbuddy.cc/api/v1",
  purchaseUrl: "https://cheapbuddy.cc/#pricing",
  preferredTextModel: "glm-5.3",
} as const;
```

`glm-5.3` 已通过 2026-10-04 普通回复、流式及工具调用，2026-10-13 再次普通文本返回 `OK`；每个用户仍按实际目录选择。`#pricing` 是固定购买入口；`#account` 已在 CheapBuddy 本地检出中补齐直达逻辑，但该改动未部署。真实购买闭环待验。商品价格、个人权益和可用模型从接口获取，不作为桌面常量。

现有用户接口路径相对于内置的 `accountApiBaseUrl`：

| 操作 | 接口 | 凭据 |
| --- | --- | --- |
| 登录设置 | 按需 `GET /settings/public` | 无 |
| 登录 | `POST /auth/login` | 登录输入和实际启用的验证字段 |
| 2FA | 部署需要时 `POST /auth/login/2fa` | 现有临时登录凭据 |
| 会话刷新/结束 | `POST /auth/refresh`、`POST /auth/logout` | 按部署 DTO 使用会话凭据 |
| 当前账号、余额 | `GET /auth/me` | 用户 access token |
| 已购会员 | `GET /subscriptions/active` | 用户 access token |
| 托管 Key | `GET /keys`、`POST /keys` | 用户 access token |
| 可售商品与购买配置 | `GET /payment/checkout-info`，部署需要时补充 `GET /payment/plans` | 用户 access token |
| 实际模型目录 | Relay `GET /v1/models` | 用户 API Key |

沿用现有 DTO，不要求 CheapBuddy 创建新的包装接口。会员接口不可用时保留登录与 Provider 能力，并明确表示会员状态尚未同步。

## 3. 整改任务

### W1. 添加品牌并设置新安装默认

在共享 Provider 目录增加 `cheapbuddy`，显示名称 `CheapBuddy`；协议适配可复用 OpenAI 兼容文本接口，品牌 ID 与协议类别分开。媒体目录也显示这个品牌，不生成按 Sub2API group 拆分的配置。

同步三处初始配置：React 初始值、TS 运行时 `defaultDesktopConfig`、Rust `default_config`。初始配置可以包含品牌和已知 Relay URL；未登录不含 Key，不把推荐模型标为已验证可用。

默认和升级规则：

- 配置不存在时创建 CheapBuddy 初始配置；用户登录后补齐模型和凭据引用。
- 已有配置升级只添加 CheapBuddy 选项，不覆盖用户显式默认、模型、其他 Provider 或工作流绑定。
- 用户点击“设为默认”后，再更新对应能力默认和兼容顶层配置。
- 同步 portable/customer seed 中的默认识别逻辑，覆盖已有用户配置必须遵循用户既有选择。不能仅因旧 Provider ID 为 `local` 就替换它。

**完成标准：** 三处初始值一致；新安装默认 CheapBuddy；旧用户升级和登录后配置保留。

### W2. 登录后读取现有商品接口

已新增 `apps/desktop/src/cheapbuddy-account.tsx` 与专用 CSS，集中展示登录、账号、余额、会员和商品，使用内置 Provider 常量与既有用户 DTO。完整 App 与独立面板浏览器验收已通过。

已知异常 warning 映射为中英文提示，未知 warning 不直接渲染；未登录时不显示“本次会话”存储提示，连接后按 `persistent` 显示真实存储状态。

未登录时显示“登录后查看套餐”和官网购买按钮，不请求需要用户会话的商品接口。登录成功后，通过现有 Tauri→Host 网络通道调用 `/payment/checkout-info`，按部署版本必要时补充 `/payment/plans`；Host 使用已有 Node `fetch`。

根据实际 DTO 映射商品名称、类型、金额、币种、说明和有效期。若接口没有返回某类官网充值档位，要求 CheapBuddy 在既有接口补兼容字段；桌面只展示返回的商品，不从官网页面抓取或在代码里复制价格。

2026-10-04 实测两个接口的会员 `plans` 均为空，checkout-info 没有官网余额充值档位。当前官网五档商品实际是余额充值。要求 CheapBuddy 在既有 checkout-info 增加 `recharge_options`（`id/name/amount/currency`，可选 `description`），会员 `plans` 保留原语义；桌面分别映射“余额充值”和“会员”。新增字段部署前仅显示官网购买入口和目录未同步状态，不能以会员空目录概括官网全部商品。

2026-10-13 线上仍缺少该充值字段，真实账号商品数为 0。桌面已实现“充值目录尚未同步，前往官网购买”状态，没有写入示例套餐或价格。CheapBuddy 本地 Worker 扩展已完成，共用官网 `src/pricing.js`，部署后才能验证真实充值卡片。浏览器验收中的商品是明确的模拟数据，不能用作线上商品已展示的证据。

进入已登录账号页面、购买返回或用户点击刷新时读取数据。缓存按账号隔离并记录更新时间；断网可展示最后一次有效结果并标注未同步，换号清除旧账号数据。启动和离线本地工作流不强制请求账号或商品接口。

充值写“充值”，会员展示实际周期；空目录显示“暂无可售套餐”。会话失效要求重新登录，不把认证失败显示成空目录；价格或周期缺失时不伪造数值或自动续费文案。

**完成标准：** 未登录有登录及购买入口；登录后展示服务端真实商品；空目录、会话过期和断网有明确状态。

### W3. 接入现有登录和托管 Key

已新增 `apps/desktop/runtime/cheapbuddy-account.ts`，承担既有 API 调用、会话刷新和托管 Key 协调。通过既有 Tauri 桥接接入窄 `cheapbuddy.account` Host IPC，非秘密 DTO 位于 `src/cheapbuddy-contract.ts`；没有新建通用账号框架。

登录及自动配置顺序：

1. 使用内置账号地址，按需读取 `/settings/public` 中实际启用的登录验证选项。密码只用于本次登录，完成后清空表单，不持久保存。
2. 调用现有登录 API；要求 2FA/验证码时完成该验证分支。尚未实现的验证分支给出明确状态，不能当作登录成功或绕过验证。
3. 从当前已认证账号获取 Key。优先使用记录的本设备、本应用 Key ID；需要查询时处理分页，不能只看前 20 条。
4. 没有有效托管 Key 时以名称 `Coworkany/<device_id>` 调用现有创建 API。默认绑定由服务端处理；桌面不硬编码上游 `group_id`。
5. 创建超时先查询/确认已有结果；无法确认时提示重试，不盲目反复创建。只恢复本应用管理的 Key，不借用其他客户端的 Key。
6. 使用取得的 Key 请求 Relay 模型目录，组装单一 Provider 配置并保存。配置持久化成功后才报告“已连接”。

**历史门槛与当前结果：** 2026-10-04 省略分组的 Key 曾无法读取目录；2026-10-13 相同默认无分组创建已通过，当前目录为 12 个文本、1 个图片、1 个视频模型。旧 502 不再是当前结论。Host 仍保留兼容保护：先使用服务端默认；只有通过当前账号的 available-groups 权限校验且 OpenAI 候选唯一时才回退，不硬编码分组数字，歧义给出错误并清理失败临时 Key。Key 列表和创建沿用原接口。

本轮真实登录、文本、账号刷新复用、临时 Key 删除和退出已通过；配置写入失败的完整 App 回归证明：持久化失败时不报告已连接，清空密码并显示错误，重试写入成功后才连接。验证码/2FA 有实现与模拟覆盖，但未对启用这些分支的真实账号验收。

状态至少区分：未登录、验证中、配置中、已连接、已登录但无可用模型、会话过期、配置失败。没有余额/会员时保留账号和购买入口；服务端权限错误与网络故障分别展示。

会话过期按现有刷新接口处理。换号、退出时清理旧凭据和账号配置引用，使旧账号的未完成异步响应不能覆盖新账号；不重放已有输出或工具副作用的模型任务。若用户选择撤销托管 Key，调用既有 Key 删除/禁用接口，仅操作该应用记录的 Key。

**完成标准：** 正常登录后无需手动配 Key；重复登录不持续增 Key；换号不串用凭据；实际启用的验证分支完成联调。

### W4. 保存凭据并连接模型运行时

改造前没有可复用的系统凭据路径；本轮已为 CheapBuddy 增加 `credentialRef`，会话及 Key 由 Host 受控保存。实际实现采用 `apps/desktop/runtime/credential-store.ts` 的 OS CLI 存储，**未新增原拟议的 `src-tauri/src/credential_store.rs`**：macOS 使用 `/usr/bin/security` Keychain，Windows 使用 PowerShell CurrentUser DPAPI 加密文件，Linux 使用 `secret-tool`。秘密通过 stdin 传入，未放在命令行参数中。

CheapBuddy 配置、导出、备份和 UI 状态仅保留非秘密信息与凭据引用。Host 在执行请求时解析引用，在内存或运行子进程的受控环境中注入真实 Key；不把引用当作 API Key，不把新 Key 持久写入 OpenCode 普通配置文件。

TS 配置解析、导入/导出、Host `readProvider/readProviderMap` 及共享 Provider 类型须保留引用。凭据库不可用时仅支持本次会话并告知状态；portable 目录复制不携带另一设备可用的账号秘密。

不在本期全面迁移其他 Provider 的历史明文 Key。新增依赖遵守项目约定，方案不预设新的 HTTP 或密钥管理 SDK。

**完成标准：** 重启可恢复登录；普通配置、备份、诊断、日志和导出中没有新账号秘密；Host 能使用引用完成真实请求。

**当前验证边界：** 真实 macOS synthetic 凭据写入、读取、删除通过；Windows/Linux 为 mock，尚未真实设备验收。本轮真实账号 smoke 使用 session-only（`persistent=false`），没有证明真实账号重启恢复。泄漏扫描覆盖 13,222 个来源、测试、文档、产物与证据文件，未发现附件 API Key；浏览器及服务回归也验证新秘密不进入 UI/配置/诊断。

### W5. 按能力选模型，保持单一 Provider

改造前只有一个 `model` 和平面的 `models`，同一 profile 的能力选择会相互覆盖。本轮已增加本地字段 `capabilityModels`，按能力保存默认值与候选目录；无需 CheapBuddy 新增 API。

```typescript
type CapabilityModelSelection = {
  readonly model?: string;
  readonly models: readonly string[];
};

// DesktopProviderConfig 已实现字段；ProviderCapability 使用既有类型。
type CapabilityModelSelections =
  Partial<Record<ProviderCapability, CapabilityModelSelection>>;
// readonly capabilityModels?: CapabilityModelSelections;
```

所有能力仍指向同一个 `cheapbuddy` profile 和同一个 `credentialRef`。兼容 `model/models` 可继续代表文本；能力专属选择由 `providerForCapability` 和模型绑定逻辑解析到实际请求。

模型发现已读取既有 `modality/capabilities` 等元数据，区分文本、图片生成和视频生成，支持常见大小写及缩写。CheapBuddy 混合目录的文本过滤已修正；输入视觉/vision 不被当成图片生成，并保留其他 Provider 的兼容行为。

已实现映射：`text_generation` → 文本；`text_to_image` → 图片生成，`image_edit/variation` 为图片相关能力；`text_to_video/image_to_video/reference_to_video` → 视频生成。不能因 `modality` 缺失丢弃目录。2026-10-04 曾读取 9/1/1 的目录，部分导出 ID 当时不可见；2026-10-13 当前读取 12/1/1。模型有效性始终以当前账号目录为准，推荐默认仍为已实调的 `glm-5.3`。

默认文本模型优先使用内置的 `preferredTextModel`，但必须在当前 Key 可用目录中且满足所需能力。推荐项不可用时选适用模型；能力不明时不承诺可用。刷新保留仍有效的用户选择，模型失权时要求重新选择或确认默认替换。

同步配置归一化、文本模型选择器、媒体选择器和工作流绑定；节点显式模型覆盖只作用于该任务。

**完成标准：** 改图片模型不改文本/视频模型；所有能力共用 Provider 和 Key；不会把图片或视频模型送入聊天接口。

### W6. 接通 Relay 图片与视频

图片优先复用共享 `createOpenAICompatibleImageAdapter`，调用 Relay `/v1/images/generations`；参数和响应按 CheapBuddy 现有媒体文档验证。

已补充 CheapBuddy 专用视频适配器 `createCheapBuddyVideoAdapter`，使用 `/videos` 提交、任务查询和受保护 content 下载；复用现有图片适配器。以下协议接线与同源鉴权/幂等行为已有 mock 回归。

- 提交：`POST /v1/videos`，映射部署实际支持的参数。
- 查询：`GET /v1/videos/{id}`，映射实际任务状态到本地任务状态，保留失败/取消与超时恢复处理。
- 结果：按文档处理 `GET /v1/videos/{id}/content`。需要鉴权时由 Host 限定 Relay 同源并带 API Key 下载，落入现有本地 artifact 流程；跨域结果 URL 不转发 Key。
- 对现有支持幂等的媒体调用透传 `Idempotency-Key`，不能只在请求 JSON 里放 `idempotency_key`。模糊提交结果不直接重新生成收费任务。

最小改动可以是共享媒体运行时中的 CheapBuddy 视频适配器，或现有 adapter 的窄分支；具体采用哪种按现有复用点选择，不增加第三方 SDK。

**完成标准：** 图片生成、视频提交/轮询/鉴权下载通过同一 Key 完成，并进入现有结果保存与展示流程。

本轮完成代码及 mock 验证，没有生成真实图片/视频；reference-video 的线上参数、任务和结果协议未验证。不能把 W6 代码完成或目录可见写成真实媒体验收通过。

### W7. 官网购买与权益刷新

已新增**零参数**原生命令 `open_cheapbuddy_purchase`，固定打开 `https://cheapbuddy.cc/#pricing`，调用者无法传入其他 URL；底层复用 `platform::open_url_command`。`open_external_preview` 保留 HTTP loopback 的本地预览边界。

点击未登录页的购买入口或任意套餐购买按钮，打开内置的 `purchaseUrl`。系统浏览器未登录时按照网站流程登录；桌面 token 不放进 URL。首期不新增桌面下单、支付适配或订单轮询。

返回应用时，对已登录账号触发有界刷新；保留明确的“刷新余额与会员”按钮。读取账号、会员、商品及模型目录后更新本地状态；浏览器返回本身不能显示“已到账”。可重用有效 Key，不为每次购买重新生成 Key。

**完成标准：** 能打开真实官网购买入口，服务端权益到账后刷新可见；取消付款和单纯浏览器返回不改变余额或会员。

完整 App 模拟验收已证明零参数命令调用及购买返回后仅一次有界刷新；不会仅因窗口 focus 宣称到账。尚未执行真实下单、充值或支付到账验收。

## 4. 代码修改位置

以下按 2026-10-13 实际落地更新，路径相对于 Coworkany 仓库；保留原改造范围，标明已实现与被替代的选择。

| 文件 | 修改责任 |
| --- | --- |
| `packages/workbench-ui/src/provider-catalog.ts` | 共享 CheapBuddy 品牌目录 |
| `apps/desktop/src/provider-platforms.ts` | 品牌→协议映射、媒体入口、归并单 profile |
| `apps/desktop/src/provider-config.ts` | `credentialRef/capabilityModels` 类型、导入、能力解析和默认选择 |
| `apps/desktop/src/provider-model-discovery.ts` | 真实模型目录与混合能力过滤 |
| `apps/desktop/src/workflow-provider-binding.ts` | 能力模型目录与节点显式模型绑定 |
| `apps/desktop/src/App.tsx` | 初始配置、设置入口、模型更新和运行 payload |
| `apps/desktop/src/cheapbuddy-account.css`、`main.tsx` | 已实现账号样式与入口加载；中英文文案位于账号组件 |
| `apps/desktop/src/cheapbuddy.ts` | 已新增：内置常量与单一 Provider 创建/合并 |
| `apps/desktop/src/cheapbuddy-contract.ts` | 已新增：非秘密账号、商品和动作 DTO |
| `apps/desktop/src/cheapbuddy-account.tsx` | 已新增：账号与商品 UI |
| `apps/desktop/src/tauri.ts` | 复用既有 invoke/listen 桥接；未新增通用网络入口 |
| `apps/desktop/runtime/config.ts` | 初始配置与显式字段归一化 |
| `apps/desktop/runtime/cheapbuddy-account.ts` | 已新增：既有 API、会话、商品和托管 Key 协调 |
| `apps/desktop/runtime/host.ts` | 窄 IPC 命令、凭据解析、模型发现和媒体请求/下载 |
| `apps/desktop/runtime/opencode-serve.ts` | 文本运行时凭据注入与账号切换生效 |
| `apps/desktop/runtime/credential-store.ts` | 已新增：Host OS CLI 凭据存储及 session-only 回退，替代原 Rust 文件提议 |
| `apps/desktop/src-tauri/src/config.rs`、`lib.rs` | Rust 初始值、seed 合并、凭据/购买桥接 |
| `packages/provider-runtime/src/index.ts` | 配置层凭据引用兼容；最终请求由 Host 注入真实 Key |
| `packages/media-runtime/src/index.ts` | Relay 视频协议及复用图片适配 |
| `scripts/verify-desktop-network-boundary.mjs` | 精确允许 CheapBuddy 所需域名，保留离线网络边界 |

这些是改造范围，不要求新增每个模块的替代实现。保留当前工作区其他功能改动，按任务做小范围修改。

## 5. 实施顺序与联调条件

**前置阶段：先调通 CheapBuddy 已有接口。** 使用测试账号验证登录、账号查询、Key 读取/必要创建、Relay 模型目录、会员和 checkout-info/plans。记录实际部署 DTO 与失败原因；在这一步完成前，不预先要求服务端修改默认 Key 规则、增加商品字段或新增接口。

路由无凭据返回 401 只证明鉴权入口可达。后续本地账号适配、界面和必要接口整改依据真实认证联调结果实施；如以后部署新接口，安排在既有链路验证之后联调。当前方案仍是零新增公共接口。

2026-10-04 前置阶段发现默认 Key 与充值目录两项缺口，证据留在 `.artifacts/cheapbuddy-existing-api-20261004/`。2026-10-13 Coworkany 业务代码已实现，默认无分组 Key 线上复测通过，充值目录仍缺失；临时 Key 删除、账号刷新复用和退出已确认。两次日期结论分开使用。本轮没有实调 `/auth/refresh` 做 token 轮换；该接口的真实验证属于 10 月 4 日记录，本轮轮换逻辑由单元测试覆盖。

1. **Provider 基础：** W1，完成内置品牌、固定地址、默认规则和未登录入口。
2. **登录与凭据：** W3、W4，用 CheapBuddy 测试账号核验 DTO、Key 默认绑定及安全存储。
3. **套餐与模型：** W2、W5、W6，完成登录后商品展示、能力选择、文本工具调用及媒体调用。
4. **购买闭环：** W7，在官网测试支付或约定测试渠道完成商品和权益刷新。
5. **回归发布：** 完成新安装、升级、portable 和跨账号场景后制作测试包。

联调依赖：固定地址和购买入口已确认；普通用户登录、Key 创建及既有商品接口可用；无客户端分组映射也能拿到可用统一 Key；提供媒体模型元数据和实际协议说明。

## 6. 验收与验证命令

必须覆盖以下实际场景：

- 新安装未登录默认 CheapBuddy，但不发匿名模型调用；其他 Provider 可选。
- 老用户升级、登录和刷新套餐后，显式默认模型及其他 Provider 不被覆盖。
- 正常登录完成自动配置；验证码/2FA、会话过期、无权益和 Key 创建超时各有明确处理。
- 重复登录复用托管 Key；退出/换号不串号；旧请求不覆盖新账号状态。
- 普通配置、备份、导出、诊断及日志扫描不到新 token/Key；复制 portable 目录需重新认证。
- 文本流式和工具调用正常；图片、视频分别选模型，视频结果鉴权下载成功。
- 未登录不请求鉴权商品接口；登录后的商品与官网一致；价格更新刷新可见；购买返回刷新实际权益，取消和未到账不误报成功。
- 离线本地工作流不因账号或商品刷新被强制联网或阻断。

实施后执行现有命令：

```bash
pnpm desktop:typecheck
pnpm desktop:test
pnpm desktop:tauri:check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm check:shared-boundaries
pnpm test:desktop-network-boundary
pnpm test:desktop-bundle-boundaries
pnpm test:desktop:offline-egress
```

相关回归应覆盖现有 `provider-config`、`provider-platforms`、`provider-model-discovery`、`workflow-provider-binding`、`media-runtime` 和 `host-session` 测试；共享媒体适配器测试位于 `packages/media-runtime/test/provider-adapters.test.ts`。新增账号、商品 DTO 映射及内置配置一致性场景放入 `apps/desktop/test/cheapbuddy-account.test.ts` 等现有 `*.test.ts` 范围；新增 TSX 界面验收需明确接入执行器，当前通配符不会自动执行所有 TSX 文件。

构建使用目标平台既有打包入口，再运行 `pnpm desktop:verify-bundle` 和 `pnpm desktop:verify-network-boundary`。真实账号、模型、支付和 Windows/macOS 凭据存储用联调记录验证，不能用单元测试结果替代。

**2026-10-13 执行结果：** 桌面全量 674/674（0 fail、0 skip），Rust 81/81，完整 App 与独立账号面板浏览器 2/2；typecheck、相关 lint、Host/UI 生产构建、shared boundaries、bundle boundaries 通过；构建后 Host 离线回归 1/1（0 skip）。完整 App 覆盖保存失败不误报已连接、重试恢复、图片目录隔离、受管字段禁用和退出后默认项保留。

**未通过的发布 gate：** 最终产物 `desktop:verify-network-boundary` 返回 exit 1、6 项命中：既有 Pixi 控制台品牌文档 URL 1 项，既有 `@silurus/ooxml` 可选 Google Fonts 请求代码 5 项。库中 `useGoogleFonts` 未指定时归一为 false，静态扫描不能证明运行时一定请求，但也不能因此宣布 gate 通过。本轮未放宽外联 allowlist 规避结果。Host/UI 构建通过不等于原生发布安装包已生成；本轮未制作新安装包，也未部署。

逐项状态及日志索引：[verification-results.json](../../.artifacts/cheapbuddy-implementation-20261013/verification-results.json)、[交付报告](../../.artifacts/cheapbuddy-implementation-20261013/README.md)。

## 7. 需要在实施中确认的实际条件

- 默认无分组 Key 当前已复测可用；保留权限范围内的兼容回退，其他账号权益仍需按实际目录校验。
- 线上充值目录仍缺失，CheapBuddy 本地 Worker 扩展须部署后复测；会员空目录本身不构成错误。
- 启用验证码/2FA 的真实账号验收尚未覆盖；网页 Cookie 不自动成为桌面会话。
- macOS 真实 synthetic 凭据检查已通过，Windows/Linux 仅 mock；真实账号重启恢复未验证。
- 真实图片/视频、reference-video 协议、官网支付到账仍未验收。
- 既有依赖造成的 6 项静态网络 gate 命中仍阻塞发布；不得以扩大 allowlist 代替处理。

本次仍为零新增公共接口。代码和本轮明确列出的验证已经完成；以上发布与真实环境验收限制保留，不能将本轮交付表述为已部署或可直接发布。

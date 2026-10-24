# cheapbuddy.cc 整改方案：复用现有接口接入 Coworkany

日期：2026-10-03
更新日期：2026-10-13
版本：4，保留原方案并补充本轮实现、复测与发布限制。
状态：CheapBuddy 官网/Worker 本地整改已完成，未部署；线上默认无分组 Key 已复测可用，充值目录扩展仍未上线。
配套文档：[Coworkany 整改方案](2026-10-03-coworkany-cheapbuddy-remediation.zh-CN.md)

本轮交付见 [2026-10-13 交付报告](../../.artifacts/cheapbuddy-implementation-20261013/README.md)。改造检出目录为 `/Users/beihuang/Documents/github/cheapbuddy-coworkany-integration`，基准 commit `a771494542d0c9a1adc6a1e9d93f202971353775`；本轮没有提交、推送或部署。

## 1. 目标与范围

让用户在 Coworkany 使用 CheapBuddy 账号登录后，自动取得统一模型 Key、查看套餐并进入官网购买。Provider 名称、模型地址、账号地址、购买入口和推荐模型由 Coworkany 内置。

本次 **零新增公共接口**。登录、Key、账号、会员、商品信息沿用现有用户 API；模型调用进入 Relay；订单和付款在 CheapBuddy 官网完成。未登录的桌面显示登录及官网购买入口，登录后读取套餐。

| 层次 | 既有职责 | 本次工作 |
| --- | --- | --- |
| CheapBuddy 官网 | 账号入口、商品展示、订单和付款 | 验证已有购买入口，与现有接口的商品信息一致 |
| Sub2API | 用户、API Key、会员、商品、余额、最终计费 | 核验用户接口；必要时补默认 Key 绑定和商品展示字段 |
| Relay | 单一 API Key；屏蔽上游系统和接口差异 | 核验模型目录、文本与媒体调用 |
| NewAPI | 图片和视频执行 | 保持为 Relay 内部实现 |

Coworkany 连接一个 CheapBuddy Provider。Sub2API 分组选择、NewAPI 账号和上游凭据由 CheapBuddy 服务端处理。

## 2. 交付给 Coworkany 的内置配置

| 配置项 | 当前约定值 |
| --- | --- |
| Provider ID | `cheapbuddy` |
| 展示名称 | `CheapBuddy` |
| 模型 Base URL | `https://api.cheapbuddy.cc/v1` |
| 账号 Base URL | `https://cheapbuddy.cc/api/v1` |
| 官网购买入口 | `https://cheapbuddy.cc/#pricing`，源码存在该价格区锚点，实际付款闭环待验 |
| 推荐文本模型 | `glm-5.3`，测试账号已通过普通回复、流式输出和工具调用；仍需核对每个用户目录 |

这些值在实施时由两边确认，随 Coworkany 版本维护。用户的套餐价格、余额、会员状态和可用模型仍从既有接口获取，不能把示例商品或价格写成桌面内置常量。

## 3. 现有账号与商品 API 核验

以下路径相对于 `https://cheapbuddy.cc/api/v1`，继续使用既有鉴权和 DTO。

| 接口 | 桌面用途 |
| --- | --- |
| `GET /settings/public` | 按需读取验证码、2FA 等公开登录设置 |
| `POST /auth/login` | 返回普通用户会话，处理实际启用的验证方式 |
| `POST /auth/login/2fa` | 部署启用两步验证时完成现有流程 |
| `POST /auth/refresh`、`POST /auth/logout` | 按部署版本刷新或结束会话 |
| `GET /auth/me` | 当前账号与余额，以部署 DTO 为准 |
| `GET /subscriptions/active` | 已购会员和权益，不用作可售目录 |
| `GET /keys`、`POST /keys` | 当前用户读取和创建应用专用 Key |
| `GET /payment/checkout-info` | 已登录用户的商品、支付配置及购买限制，以实际返回字段为准 |
| `GET /payment/plans` | 部署版本需要时补充读取可售会员计划 |

普通用户从桌面 Host 网络层使用这些接口，遵守既有验证码、限流和权限。模型 Relay 仍只承载模型请求，账号 API 继续由既有 Sub2API 入口承载。

### C1. 核验登录与会话

提供测试账号，核对登录成功、验证码/2FA、刷新、退出和会话失效的实际响应。桌面不用管理员凭据，也不能把网页登录 Cookie 视为桌面会话。

**交付条件：** 部署实际启用的验证分支能完成登录，成功后得到普通用户身份和会话。

2026-10-04 实测普通用户登录、`/auth/me`、`/user/profile`、会话刷新及刷新后查询均返回 HTTP 200、业务码 0；登录返回 access token 与 refresh token。退出接口传本次会话 refresh token 返回 200，再使用该 token 刷新返回 401，已验证撤销；不承诺 access token 立即失效。该账号无需 2FA；未覆盖启用验证码/2FA 的其他账号。

### C2. 核验与修正默认 Key 绑定

**2026-10-04 历史缺口：** 当时 `POST /keys` 只传名称时创建成功，但 `group_id=null`，该 Key 请求 Relay `/v1/models` 返回 502 `Model list unavailable`。显式传该账号可用分组的对照测试返回 200 和 11 个模型；两枚测试 Key 均已删除。此结论只描述当时部署。

**2026-10-13 当前复测：** 默认不传 `group_id` 的 Key 创建和目录读取已成功；目录包含 12 个文本、1 个图片、1 个视频模型，`glm-5.3` 文本返回 `OK`。账号刷新复用同一托管 Key，临时 Key 已删除并确认列表中不再存在，退出成功。不能继续把历史 502 描述为当前阻塞，也不能据此推断本轮本地 Worker 改动已经上线。证据：[真实账号联调](../../.artifacts/cheapbuddy-implementation-20261013/live-account-smoke.json)。

1. 创建请求可只传名称 `Coworkany/<device_id>`，由服务端绑定当前用户可用的 CheapBuddy 默认统一配置。
2. 默认规则可在既有账号 API 的 Worker 代理边界实现；若部署绕过该 Worker，则在实际 Sub2API 部署实现等价规则。默认分组须按当前用户权限选择，不能把历史测试数字变成桌面常量。显式指定分组的既有客户端行为保留。
3. Key 列表或详情若已有完整 Key，允许桌面复用本设备托管的有效 Key。若只返回掩码，创建响应应返回完整 Key，由桌面安全保存后复用。
4. 核验创建接口的既有幂等能力；没有能力时桌面创建超时先查已有结果，无法确认则提示重试，避免不断创建。
5. 无默认配置或模型权益时，返回明确的现有业务状态；用户仍可登录、查看账号和购买。

**交付条件：** 普通用户不手选上游分组即可取得统一 Key，权限与模型目录一致；无权分组不会被静默绑定。

现有 Key 列表和创建响应已实测返回完整 Key。原官网缺少 `VITE_CHEAPBUDDY_GROUP_ID` 时固定使用分组 1 的行为已在本地去除。新增 `cloudflare-worker/account-integration.mjs`：仅对省略 `group_id` 的请求，用调用者 Bearer 凭据查询 `/groups/available`；选择获准使用且 `platform=openai/status=active` 的分组。配置 `CHEAPBUDDY_DEFAULT_GROUP_ID` 时必须匹配授权列表，未配置时必须只有一个合格候选；无权限、歧义、查询失败和显式分组请求保持透传，最终由 Sub2API 校验。本地实现尚未部署。不能仅按第一条 Key 记录复用未经目录验证的 Key。

### C3. 核验商品目录与官网一致性

确认现有 `/payment/checkout-info` 及必要的 `/payment/plans` 能返回桌面实际要展示的商品：名称、真实价格、币种、类型、说明及会员周期。

现有接口未返回某类官网商品时，只在这些既有接口补兼容的商品展示字段，沿用现有 DTO 和普通用户鉴权，不新增商品接口。前后端共用同一有效商品配置；桌面只展示服务端返回的商品。

当前官网 `src/pricing.js` 是独立充值档位配置。不能假设这些档位已经全部出现在 checkout-info 中；应核验并对齐官网与既有接口的数据源。余额充值与会员分别展示，会员周期和自动续费文案必须符合真实规则。

**仍未上线的缺口：** 2026-10-04 实测两个接口的会员 `plans` 均为空；2026-10-13 复测仍未取得 `recharge_options`。会员空目录与充值目录缺失是不同状态，不能把余额充值填入会员 `plans`。

最小兼容扩展：在既有 `/payment/checkout-info` 增加 `recharge_options` 数组，每项仅要求 `id`、`name`、`amount`、`currency`，可选 `description`。`amount` 是该币种下的实际付款金额；到账余额仍按现有倍率/费率规则计算。官网与接口共用服务端商品配置，桌面不复制五档价格。已有 `plans` 保持会员语义；未配置会员计划时为空是合法结果。该扩展不新增路径或鉴权体系。

本地已实现该扩展：Worker 只改写 Bearer 鉴权且 HTTP 成功、业务码为 0 的 checkout-info；`getRechargeOptions()` 直接复用 `src/pricing.js` 的官网档位，输出规范 CNY 金额与币种，保留原会员计划、支付配置、Cookie 和其他响应信息。英文 Stripe 仍由既有 `src/payment.js` 派生 USD 付款金额，目录不是最终支付报价。未鉴权、业务错误及畸形响应保持原样。部署时官网与 Worker 必须使用同一价格版本。

**交付条件：** 已登录账号的商品列表与官网一致；无商品返回明确空目录；桌面不从已购会员或分组推算售价。

## 4. 官网购买入口

### C4. 验证已有购买页面

购买入口继续使用 `https://cheapbuddy.cc/#pricing`。`#account` 的直达逻辑在 2026-10-04 尚未实现，本轮已在本地补齐：未登录打开登录，登录后打开账号面板；模拟浏览器登录、注册与单一弹窗验证通过。该官网改动未部署，实际付款闭环仍未验收。首期商品共用一个入口，不要求按套餐直接跳转。

网站使用既有登录、订单和付款流程；最终价格及权益发放由 Sub2API 确认。桌面登录态与系统浏览器登录态独立，网站未登录时正常要求登录，不通过 URL 传递账号 token。

**交付条件：** 从桌面打开既有入口后，可以完成官网购买；付款到账能在账号和会员接口读取。

## 5. Relay 核验

### C5. 同一 Key 的文本与媒体调用

以同一 CheapBuddy API Key 验证 `/v1/models`、文本请求、图片请求、视频创建与任务查询。只验证账号有权益的模型，保留既有模型能力字段和任务协议。

混合目录必须能区分文本、图片生成、视频生成；优先沿用现有 `modality/capabilities`。若部署响应缺少必要元数据，在既有 `/v1/models` 补兼容字段。输入视觉能力不等于图片生成能力。

2026-10-04 目录返回 `capabilities/type/display_name`，当时为 9 个文本、1 个图片、1 个视频模型；能力值包括 `text_generation`、`text_to_image/image_edit/variation`、`text_to_video/image_to_video/reference_to_video`。当时缺少 `modality`，部分导出配置中的文本 ID 也未出现在该账号目录。Coworkany 已适配既有能力值，无需新增目录接口。

2026-10-13 认证读取的当前目录为 12 个文本、1 个图片、1 个视频模型；只实调了 `glm-5.3` 文本请求，不能把目录可见等同于全部模型执行成功。没有生成真实图片或视频，reference-video 协议也未做线上验证。

视频使用既有 `POST /v1/videos`、`GET /v1/videos/{id}` 和 `GET /v1/videos/{id}/content`；提供实际任务状态及 content 鉴权规则。Coworkany 通过 Host 完成受保护下载，Key 不进入结果 URL。

图片和视频由 NewAPI 执行，会员与最终账单由 Sub2API 管理。媒体计费、任务所有权和上游差异继续由 Relay 处理。

官网仓库未包含完整 Sub2API 后端和 Go Relay 实现，但其 Cloudflare Worker 已覆盖 `cheapbuddy.cc/api/*`，本轮可在此边界兼容扩展既有账号路由。绕过 Worker 的部署需要后端等价实现；本轮没有修改或部署 Relay/NewAPI 后端。

**交付条件：** 同一 Key 的目录与调用权限一致；媒体任务保持用户隔离；没有 NewAPI 凭据泄漏。

## 6. 修改位置与实施顺序

先联通并验证已有接口，再处理经过验证的接口缺口。首轮只沿用部署当前行为；C2 默认 Key 规则、C3 商品字段等服务端修正，以真实联调结果为依据。

阶段一必须完成测试账号的登录 → 账号查询 → 已有 Key 读取/必要创建 → Relay 模型目录 → 会员与商品读取，并记录部署版本、脱敏 DTO、实际错误和可复用能力。未认证的 401 只能证明鉴权入口可达，不能代替业务联通。

阶段一完成后，才对证实缺失的规则/字段进行整改，再复测原接口。如后续确需新接口，先明确其必要性和契约，再安排第二阶段联调；当前方案仍是零新增公共接口。

| 位置 | 修改责任 |
| --- | --- |
| `src/api.js`、`src/main.jsx` | 核验官网既有登录、Key、商品和付款流程 |
| `src/pricing.js` | 仅在商品源不一致时对齐既有接口的真实商品数据 |
| `cloudflare-worker/account-integration.mjs`、`index.js` | 已在本地实现既有 checkout-info 扩展与授权范围内的默认 Key 分组 |
| 实际 Sub2API 部署代码 | 仅在请求绕过该 Worker 时实施等价规则；保持最终权限/计费校验 |
| 实际 Relay 部署 | 核验目录和媒体协议，修正真实不兼容问题 |
| 官网已有购买页面 | 按需修正现有入口导航，使用户能完成购买 |

实施顺序：已有账号、Key、目录、商品接口联调 → 形成差异清单 → 必要的既有接口整改 → 回归验证 → C4 官网购买与 C5 模型执行联调。接口核验通过则不要求额外业务改造。

2026-10-04 已完成普通用户认证联调：登录、账号、Key 列表、可用分组、会员、checkout-info/plans、刷新均通过；已有统一 Key 的模型目录、`glm-5.3` 普通回复/流式/工具调用和媒体用量查询通过。会员和会员商品目录为空是当前账号/部署的实际结果。确认两项服务端缺口：省略分组的 Key 不可用；官网充值目录未进入既有商品接口。

2026-10-13 已完成本地官网/Worker 整改及现有接口复测：C2 当前线上默认 Key 可用；C3 的兼容扩展已完成本地代码与测试，但线上字段仍缺失。两次联调证据分别保存在 `.artifacts/cheapbuddy-existing-api-20261004/` 和 `.artifacts/cheapbuddy-implementation-20261013/`，不得混用日期结论。

- [x] 本地既有账号路由兼容整改、共用充值配置、官网默认分组和入口修正。
- [x] `npm test` 60 项通过，官网生产构建、Worker 打包和模拟官网浏览器验收通过。
- [x] 当前线上登录、无分组 Key 创建、目录、文本、刷新、临时 Key 删除和退出复测。
- [ ] 同步部署官网与 Worker，复测线上 `recharge_options`；保留官网账号路由经过该 Worker。
- [ ] 真实图片/视频、reference-video 协议与官网支付到账验收。

## 7. 验证与交付

官网代码有变更时，在 CheapBuddy 仓库执行既有 `npm test` 和 `npm run build`；后端和 Relay 有变更时执行各自部署仓库对应的测试。

测试账号联调覆盖：登录及验证、会话刷新、专用 Key 创建和恢复、商品读取、同 Key 文本/图片/视频调用、官网付款和权益查询。正式联调涉及收费模型时使用约定测试预算。

交付给 Coworkany：

- 已确认的固定地址和推荐模型候选。
- 部署版本对应的登录、Key、checkout-info、会员和模型响应样例，全部脱敏。
- 默认 Key 规则、测试账号权益以及商品类型/价格/周期说明。
- 已验证的官网购买入口。

最终验收：既有接口可以完成登录、自动配 Key、登录后商品展示和官网购买；不要求未登录桌面展示具体套餐价格。

## 8. 源码依据与未验证项

官网源码核验基准：2026-10-04，commit `e26b72fed8fe4686d7e1c7b71ffbb195610a5260`。

- [用户 API 封装](https://github.com/GiantClam/cheapbuddy/blob/e26b72fed8fe4686d7e1c7b71ffbb195610a5260/src/api.js)：登录、Key、checkout-info 和付款接口。
- [官网账号与 Key 逻辑](https://github.com/GiantClam/cheapbuddy/blob/e26b72fed8fe4686d7e1c7b71ffbb195610a5260/src/main.jsx)：现有 Key 获取及创建行为。
- [充值配置](https://github.com/GiantClam/cheapbuddy/blob/e26b72fed8fe4686d7e1c7b71ffbb195610a5260/src/pricing.js)：独立余额充值档位，与接口商品尚未对齐。

2026-10-13 本地实现说明见 [CheapBuddy 改造交付说明](/Users/beihuang/Documents/github/cheapbuddy-coworkany-integration/docs/coworkany-account-integration.md)。完整交付与证据索引见 [本轮报告](../../.artifacts/cheapbuddy-implementation-20261013/README.md)。代码已完成不等于已部署；线上充值目录、真实媒体生成/支付、其他账号验证码/2FA 仍需验收。Coworkany 最终产物静态网络扫描还有 6 项既有依赖命中，发布 gate 未全通过，未制作新发布安装包。

# Mini Program Page Map — 小程序页面 × API 映射（T027）

页面清单来源：`specs/11-pages-and-ui.md` §Mini Program navigation / §Parent pages / §Provider pages / §Career pages。
接口来源：`implementation/frontend/api-contract-map.md`（后端真实路由）。

图例：**✅ 有现成 API** ／ **⚠️ 部分支持** ／ **❌ 缺 API**（对应 `api-contract-map.md` §17.2 缺口编号）。

---

## 1. 导航骨架

| Tab | 页面 | 依赖接口 | 状态 |
|---|---|---|---|
| Tab 1 首页 Home | — | `GET /providers?domain=TUTORING&sort=`（推荐位）、`GET /me` | ✅ |
| Tab 2 发现 Discover | — | `GET /providers`（含筛选参数） | ✅ |
| Tab 3 消息 Messages | — | `GET /conversations` | ✅（发消息 ❌ G4） |
| Tab 4 订单 Orders | — | `GET /orders` | ✅ |
| Tab 5 我的 Me | — | `GET /me`、`GET /me/profile`、`GET /providers/me` | ✅ |

## 2. 家长端页面（15）

| # | 页面 | 主要接口 | 权限 | 未成年人 | 支付 | 状态 |
|---|---|---|---|---|---|---|
| P1 | Home（首页） | `GET /providers?domain=TUTORING&pageSize=`、`GET /me` | 公开 | — | — | ✅ |
| P2 | Tutor search（搜索） | `GET /providers?city=&subject=&grade=&minPrice=&maxPrice=&sort=&page=` | 公开 | — | — | ✅ |
| P3 | Filter sheet（筛选面板） | 同 P2；**类目字典** `GET /taxonomy` 不存在 | 公开 | — | — | ⚠️ G11（可先用服务端返回的筛选参数） |
| P4 | Tutor list（列表） | 同 P2（分页、空态、排序） | 公开 | — | — | ✅ |
| P5 | Tutor detail（导师详情） | `GET /providers/:id`、`GET /providers/:id/reviews`、`GET /providers/:id/availability` | 公开 | — | — | ✅ |
| P6 | Service detail（服务详情） | `GET /providers/:id/services`（无单服务接口） | 公开 | — | — | ⚠️ G2 |
| P7 | Chat（聊天） | `POST /conversations`、`GET /conversations/:id`、`POST /conversations/:id/messages`、`GET /conversations/:id/messages?limit=`、`POST/DELETE /users/:id/block` | 买方本人 | — | — | ✅（G4 已交付） |
| P8 | Create booking（创建预约） | `GET /providers/:id/availability`、`POST /orders`（**金额服务端定**）、`GET /me/children`（选孩子） | 买方 | ✅ 儿童档案 | — | ✅ |
| P9 | Order confirmation（确认页） | `GET /orders/:id` | 买方 | 展示孩子昵称（白名单字段） | — | ✅ |
| P10 | Payment（支付） | `POST /orders/:id/payment-session`、`GET /orders/:id/payment-status`（**以服务端状态为准**） | 买方 | — | ✅ 真实支付 | ✅（mock 可本地联调） |
| P11 | Order detail（订单详情） | `GET /orders/:id`、`POST /orders/:id/cancel`、`GET /orders/:id/refunds`、`POST /orders/:id/refund-request`、`GET /orders/:id/reviews` | 买方 | — | 退款（申请） | ✅（时间线 ❌ G5） |
| P12 | Review（评价） | `POST /orders/:id/reviews`（仅 `COMPLETED`）、`GET /orders/:id/reviews` | 买方 | — | — | ✅（回复/申诉 ❌ G14） |
| P13 | Child profiles（儿童档案） | `GET/POST /me/children`、`GET/PATCH/DELETE /me/children/:id`、`GET/POST /me/consents`、`DELETE /me/consents/:consentType` | **监护人本人** | ✅ 涉未成年人 | — | ✅ |
| P14 | Reports/complaints（举报投诉） | `POST /reports`、`GET /me/reports`、`POST /reports/:id/appeal` | 登录用户 | — | — | ✅ |
| P15 | Privacy/settings（隐私与设置） | `GET/PUT /me/profile`、`GET /me/consents`、`POST /auth/logout` | 本人 | — | — | ✅ |

## 3. 导师端页面（12）

| # | 页面 | 主要接口 | 权限 | 状态 |
|---|---|---|---|---|
| T1 | Provider onboarding（入驻） | `POST /providers/applications`、`GET/PATCH /providers/me`、`POST /providers/me/submit` | 登录用户 | ✅ |
| T2 | Identity verification（身份验证） | `POST /verification/cases`、`POST /verification/cases/:id/documents/upload-url`、`PUT /files/verification/:caseId/:documentId?expires=&signature=`、`POST /verification/cases/:id/submit` | 本人 | ✅（G3 已交付：签名 URL 现在可上传） |
| T3 | Education verification（学历验证） | 同 T2（`verificationType=EDUCATION`，文档类型 `DIPLOMA`） | 本人 | ✅（G3 已交付） |
| T4 | Profile editor（资料编辑） | `PATCH /providers/me?providerType=TUTORING` | 导师本人 | ✅ |
| T5 | Service editor（服务编辑） | `POST/GET /providers/me/services?providerType=`、`PATCH /providers/me/services/:id`、`:id/publish`、`:id/unpublish` | 导师本人 | ✅ |
| T6 | Availability（可用时间） | `POST /providers/me/availability?providerType=`、`DELETE /providers/me/availability/:id` | 导师本人 | ✅ |
| T7 | Orders（订单） | `GET /orders`、`GET /orders/:id`、`POST /orders/:id/confirm` / `start` / `complete` | **导师本人**（服务提供方） | ✅（时间线 ❌ G5） |
| T8 | Earnings（收入，特性开关） | 无接口 | 导师本人 | ❌ G7（`specs/08` V1 可延后） |
| T9 | Reviews（评价） | `GET /providers/:id/reviews`（公开，按自己的 providerId） | 导师本人 | ✅（回复 ❌ G14） |
| T10 | Verification status（验证状态） | `GET /verification/me?providerType=`、`GET /providers/me` | 本人 | ✅ |
| T11 | Chat（聊天） | `POST /conversations`、`GET /conversations`、`GET /conversations/:id`、`POST/GET /conversations/:id/messages` | 导师本人 | ✅（G4 已交付） |
| T12 | Settings（设置） | `GET/PUT /me/profile`、`POST /auth/logout` | 本人 | ✅ |

## 4. 职业赛道页面（5，`career_marketplace_enabled` 为真时显示）

| # | 页面 | 主要接口 | 状态 |
|---|---|---|---|
| C1 | Mentor discovery | `GET /providers?domain=CAREER` | ✅ |
| C2 | Mentor detail | `GET /providers/:id`、`/providers/:id/services`、`/providers/:id/reviews` | ✅ |
| C3 | Career service detail | `GET /providers/:id/services` | ⚠️ G2 |
| C4 | Career order | `POST /orders` + 订单命令 | ✅ |
| C5 | Career mentor dashboard | `GET /providers/me?providerType=CAREER`、`GET /orders` | ✅（收入 ❌ G7） |

## 5. 权限与敏感约束（前端必须遵守）

| 约束 | 说明 |
|---|---|
| 儿童数据 | 只在 `/me/children*` 出现，且仅监护人本人可见；他人一律 404/403，前端不得缓存到全局 store，不得写入日志或上报（对照 `specs/10`） |
| 证件 | 上传走签名 URL（`upload-url`），前端不得保存证件原文；审核查看走 `access-url`（5 分钟，仅限 ADMIN/OPS） |
| 支付 | 前端**不传金额**；展示 `amountMinor` 需按 `分 → 元` 格式化；结果以 `GET /orders/:id/payment-status` 为准，不得以客户端回调判定成功 |
| 导师权限 | `confirm/start/complete` 仅服务提供方；买方只能 `cancel`（未支付）与 `refund-request` |
| 状态机 | 前端不得"直接改状态"，只能调用命令端点；遇到 `ORDER_INVALID_STATE` 应刷新详情 |
| Mock | 本地 `AUTH_PROVIDER=mock`、`PAYMENT_PROVIDER=mock` 可空跑登录与支付；生产环境 mock 适配器会被拒绝 |

## 6. 页面级 UX 要求（`specs/11` §UX requirements）

每个异步页面必须实现：loading / empty / error / retry / permission denied / offline-timeout。
金额页面必须展示：服务、时长、单价、总价（平台费按客户可见策略）、订单号、取消/退款规则入口；
**不得隐藏费用与退款条款**。

## 7. 统计

| 项 | 数量 |
|---|---|
| 小程序页面总数（含职业赛道，不含 5 个 Tab 容器） | **32**（家长 15 + 导师 12 + 职业 5） |
| 有现成 API 支撑 | 28 |
| 部分支撑（缺 1 项能力） | 3（P3 类目字典、P6/C3 单服务详情） |
| 完全缺 API | 1（T8 Earnings） |
| 可直接复用的接口数 | **59** |

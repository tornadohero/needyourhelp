# Admin Page Map — 管理台页面 × API 映射（T027）

页面清单来源：`specs/11-pages-and-ui.md` §Admin Web、`specs/12-admin-spec.md`。
接口来源：`implementation/frontend/api-contract-map.md`（36 条 ADMIN/OPS 路由 + 鉴权 + 探针）。

权限约定：管理端路由全部为 `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('ADMIN','OPS')`。
**前端不得放宽或绕过；无权限时后端返回 `FORBIDDEN`(403)，前端应展示"无权限"而非隐藏入口后仍发起调用。**

---

## 1. 登录与引导

| 页面 | 主要接口 | 状态 | 说明 |
|---|---|---|---|
| Login | `POST /auth/console/login`（用户名/密码，限流+锁定）；`POST /auth/refresh`；`GET /me`；`POST/DELETE /admin/console-credentials`（签发/撤销，ADMIN/OPS，审计） | ✅ | G1 已交付（T028）：凭据只对已持有 ADMIN/OPS 的账号生效，登录不授予角色；轮换与撤销均审计 |
| First-admin bootstrap | `POST /admin/bootstrap`（首位管理员自检/授权） | ✅ | 已有接口；本地首次启动后借此获得 ADMIN 角色 |
| 会话维持 | `POST /auth/logout` | ✅ | 退出即失效 refresh token |

## 2. Dashboard（KPI）

| 区块（`specs/11`） | 接口 | 状态 |
|---|---|---|
| users | `GET /admin/dashboard`（`AdminDashboardCounts`） | ✅ |
| active providers | 同上 | ✅ |
| pending verification | `GET /admin/verifications`（队列计数） | ✅ |
| orders / GMV / refund rate | `GET /admin/orders`、`GET /admin/dashboard` | ✅（GMV/退款率以返回字段为准） |
| reports | `GET /admin/reports` | ✅ |
| conversion | **无接口** | ❌ G6/G13（仅服务端埋点，无趋势序列） |

## 3. Provider review（商家审核）

| 页面/能力 | 接口 | 状态 |
|---|---|---|
| 审核队列 | `GET /admin/providers`、`GET /admin/verifications` | ✅ |
| 身份验证状态 | `GET /admin/verifications`（IDENTITY）、`POST /admin/verifications/:id/approve｜reject` | ✅ |
| 学历验证状态 | 同上（EDUCATION） | ✅ |
| 教师合规 | `GET /admin/compliance`；`POST /admin/compliance/:capabilityId/start-review｜approve｜restrict｜reject｜suspend` | ✅ |
| 公开档案预览 | `GET /providers/:id`（公开详情，只读） | ✅ |
| 通过/驳回/限制/暂停 | `POST /admin/providers/:id/approve｜reject｜suspend｜restore`、`POST /admin/compliance/:capabilityId/restrict` | ✅ |
| 查看证件 | `POST /admin/verifications/:id/documents/:documentId/access-url`（`reasonCode:'REVIEW'`，5 分钟签名 URL） | ✅ |
| 审核留痕 | `GET /admin/audit-logs` | ✅ |

## 4. Orders（订单）

| 页面/能力 | 接口 | 状态 |
|---|---|---|
| 搜索 | `GET /admin/orders` | ✅ |
| 状态 | 同上（状态字段） | ✅ |
| 支付 | `GET /admin/orders`（支付字段）、`GET /orders/:id/payment-status` | ⚠️ 管理端只能读；支付会话属买方 |
| 退款 | `POST /admin/orders/:id/refund`（`Idempotency-Key` 必带，金额服务端算） | ✅ |
| 争议 | 无直连接口 | ❌ G10（当前经审核处置动作触发 `markDispute`） |
| 时间线 | 无接口 | ❌ G5 |

## 5. Moderation（审核/举报）

| 页面/能力 | 接口 | 状态 |
|---|---|---|
| 举报队列 | `GET /admin/reports` | ✅ |
| 会话上下文（按策略允许） | `GET /conversations/:id`（成员/权限受限） | ⚠️ 管理员是否可见取决于后端策略，需确认后再暴露 |
| 处置动作 | `POST /admin/reports/:id/resolve`（`resolution` 必填，`action`: `NO_ACTION｜HIDE_REVIEW｜DISPUTE_ORDER`） | ✅ |
| 调查流转 | `POST /admin/moderation/:id/transition`（`OPEN→INVESTIGATING→ACTION_REQUIRED`） | ✅ |
| 申诉终审 | `POST /admin/moderation/:id/finalize`（**必须由另一名管理员执行**，同人执行 403） | ✅ |
| 审计 | `GET /admin/audit-logs` | ✅ |

## 6. Platform configuration（平台配置）

| 页面 | 接口 | 状态 |
|---|---|---|
| Taxonomy（类目） | `GET /admin/taxonomy`、`POST /admin/taxonomy`、`PATCH /admin/taxonomy/:id`、`POST /admin/taxonomy/:id/archive`（归档不删除） | ✅ |
| Fees（费率） | `GET /admin/platform-rules?ruleType=`、`POST /admin/platform-rules`、`POST /admin/platform-rules/:id/publish` | ✅（规则口径需与后端确认 `ruleType` 取值） |
| Cancellation policies（取消政策） | 同上（`platform-rules`） | ⚠️ G8（订单侧 `policy_snapshot` 目前为 `null`，政策未与订单绑定） |
| Feature flags（特性开关） | `GET /admin/feature-flags`、`PATCH /admin/feature-flags/:key`（如 `career_marketplace_enabled`、`provider_review_customer_enabled`） | ✅ |
| Platform rules | 同上 Fees | ✅ |
| Content（内容） | 无专门接口 | ❌ G13 类（暂无内容管理接口） |

## 7. 用户与权限

| 页面 | 接口 | 状态 |
|---|---|---|
| 用户列表 | `GET /admin/users` | ✅ |
| 授权 / 撤权 | `POST /admin/users/:id/roles`、`DELETE /admin/users/:id/roles/:role` | ✅ |

## 8. 管理台必须遵守的约束

| 约束 | 说明 |
|---|---|
| 不直接改库 | 所有运营动作走接口，接口均写审计（`specs/12`：MVP 无需直连 DB） |
| 独立复核 | 申诉终审不得由原处置管理员执行（后端已强制，前端应提前禁用入口并提示） |
| 理由必填 | 处置/合规决策/退款都要求 `reasonCode`/`resolution`，前端不得留空提交 |
| 敏感数据 | 证件仅在签名 URL 5 分钟内可见，不得缓存、不得截图留存到日志 |
| 幂等 | 退款必须携带 `Idempotency-Key`（建议前端按"订单 + 意图"生成并保存，重试复用同键） |
| CORS | 管理台来源需加入 `CORS_ALLOWED_ORIGINS`，否则浏览器读不到响应 |

## 9. 统计

| 项 | 数量 |
|---|---|
| 管理台页面（含子页面） | **14**（5 主页面：Dashboard / 商家审核 / 订单 / 审核 / 平台配置；9 子页面：登录引导、引导授权、商家详情、订单详情、案件详情、类目、费率、取消政策、开关与规则、用户权限） |
| 有现成 API | 12 |
| 部分支撑 | 2（Dashboard 转换率/趋势、取消政策与订单绑定） |
| 阻塞（缺 API） | 0 |
| 可复用接口数 | **48** |

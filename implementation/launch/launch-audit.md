# Launch audit — 能否启动？（T036）

> 与 [`repository-audit.md`](./repository-audit.md)（2026-10-12 的结构审计）和
> [`git-baseline-audit.md`](./git-baseline-audit.md)（2026-10-17 的基线审计）是同一条线上的第三次检查：
> 前两次问"仓库里有什么"，这一次问"三个端能不能一起跑起来、能不能发"。

结论先看这里：

| 环境 | 结论 | 依据 |
|---|---|---|
| **本地 / 开发** | **READY FOR LOCAL LAUNCH** | 三端真实联调通过：`pnpm test:e2e-three` 7/7（入驻 → 证件 → 控制台批准 → 发布 → 发现 → 下单 → 支付 → 交付 → 幂等退款 → 审计） |
| **预发 / 生产** | **READY AFTER FIXES** | 缺真实微信 appid、真实微信支付、外部拨测与 `/metrics`；见 §3 |

---

## 1. 三个端：当前实测状态

| 端 | 目录 | 启动方式 | 实测证据 | 状态 |
|---|---|---|---|---|
| 后端 API | `apps/api` | `pnpm --filter @mentor/api start:prod`（或 `node dist/main.js`） | `/api/v1/health` 200、`/api/v1/health/ready` 200 且 `database:"up"`；mock 登录返回 token | ✅ |
| 管理台 | `apps/admin` | `pnpm --filter @mentor/admin dev -p 3001` / `build` + `start` | 12 条路由构建通过；登录（控制台凭据）+ 9 个运营页可用；三端旅程中由管理台客户端批准商家与退款 | ✅ |
| 小程序 | `apps/miniprogram` | 微信开发者工具打开 `apps/miniprogram` | 13 个页面：家长（发现/详情/预约/订单/支付/我的）、导师（工作台/服务/时段/接单/评价/验证）；核心逻辑有 214 个单测，端到端由三端套件驱动 | ✅（真机待验） |

**三端一起跑**的证据：`apps/e2e`（T035）构建并启动真实 API 进程（一次性库，从提交过的迁移重建），
然后由**小程序的真实模块**与**管理台的真实客户端**通过 HTTP 驱动；7/7 通过。

## 2. 已解决的审计阻塞项

| # | 原阻塞项 | 解决于 | 证据 |
|---|---|---|---|
| B1 | 管理台无运营页面 | T033 | `apps/admin` 12 条路由；登录、概览、商家审核、验证队列、订单与退款、用户与角色、审计日志、开关、类目、规则 |
| B2 | 小程序无业务页面/API client | T031/T032/T035b | 预约与订单、导师工作台、支付页；`src/core/*`、`src/services/*` 共 214 个单测 |
| B3 | Redis 未接入 | T034 | `ops/redis.md`；Redis 版限流与幂等 + 内存降级；未配置时全套件仍通过 |
| B4 | 代码未提交 | T025 | `1d19e70` 及后续分组提交，`origin/main` 与本地同步（`0 0`） |
| B6 | 集成/E2E 未重跑 | T034/T035 | 集成 46 文件 / 282 测试、E2E 8/8、三端 7/7 均在当期跑过 |
| B8 | 启动文档为空 | T025 + **T036** | `environment.md`（本轮补首次运行走查）、本文件、`launch-progress.md`、`build-verification.md` |
| B9 | 任务表无小程序/管理台任务 | T031–T035b | `task-breakdown.md` 已含 T031–T035b 定义 |

## 3. 仍然阻塞发布（生产）的项

| # | 阻塞项 | 为什么 | 谁来做 |
|---|---|---|---|
| L1 | **真实小程序 appid** | 仓库仍是 `touristappid`；`wx.login()` 换取真实 code 才能登录 | 申请 appid，填 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` |
| L2 | **真实微信支付** | `PAYMENT_PROVIDER=mock` 在生产被拒绝；需商户号、API v3 密钥、商户私钥与回调地址 | 申请商户号，配齐 `WECHAT_PAY_*`，把 `WECHAT_PAY_NOTIFY_URL` 指向公网地址 |
| L3 | **私有对象存储** | 证件上传的 mock 适配器在生产被拒绝 | 接入私有 bucket 适配器，配 `OBJECT_STORAGE_*` |
| L4 | **外部拨测与 `/metrics`** | 目前只有内网自检探针，无外部可用性监控，无指标导出端点 | 见 [`ops/monitoring.md`](../../ops/monitoring.md) |
| L5 | **CI 上未实跑三端套件** | 本地已跑通；CI 有 postgres 服务但尚未验证 | 在 CI 跑一次 `pnpm test:e2e-three` |
| L6 | **多实例需 Redis** | 不配 Redis 时限流/幂等只在单实例内成立 | 部署时设 `REDIS_URL`（[`ops/redis.md`](../../ops/redis.md)） |

## 4. 发布前必须替换的占位值

`.env.example` 中带 `replace-me-*` 的项与空值项，在生产必须由环境或密钥管理器提供，
**不得以仓库里的默认值启动生产**：`ACCESS_TOKEN_SECRET`、`REFRESH_TOKEN_SECRET`、
`OPENID_HASH_PEPPER`、`OBJECT_STORAGE_SIGNING_SECRET`、`VERIFICATION_METADATA_KEY`、
`WECHAT_PAY_*`。

完整矩阵、部署顺序与回滚见 [`ops/release.md`](../../ops/release.md)；
发布门禁见 [`ops/release-checklist.md`](../../ops/release-checklist.md)。

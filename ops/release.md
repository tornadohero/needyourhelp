# Release preparation — 发布准备（T036）

> Part of [`ops/README.md`](./README.md). What has to be true before a release
> ships, in what order it happens, and how to undo it.
>
> The **gate** is [`release-checklist.md`](./release-checklist.md) — this file is
> the preparation behind that gate: the environment matrix, the build and deploy
> order, the smoke test, the tagging policy and the rollback.

## 1. Environments

`local`, `dev`, `staging`, `prod`（`specs/03-architecture-spec.md` §Environments）。
No environment may take a secret from the repository: every secret comes from the
environment or a secret manager（`AGENTS.md` §9, `specs/13`）。

Recommended topology（`specs/03` §Deployment）：managed PostgreSQL、managed Redis、
private object storage、one backend service、one admin web deployment、one
mini-program release channel、CI/CD through GitHub Actions。

## 2. Environment variables

| 变量                                          | 用途                                    | 生产要求                                                       |
| --------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| `NODE_ENV`                                    | 运行模式                                | `production` —— 决定 mock 适配器是否被拒绝                     |
| `API_PORT`                                    | API 监听端口                            | 必填                                                           |
| `DATABASE_URL`                                | 主库                                    | **密钥**；托管库连接串                                         |
| `DATABASE_TEST_URL`                           | 测试/一次性库                           | 仅测试用，生产不需要                                           |
| `REDIS_URL`                                   | 限流与幂等的共享存储                    | 多实例**必需**；置空则降级为单进程（[`redis.md`](./redis.md)） |
| `ACCESS_TOKEN_SECRET`、`REFRESH_TOKEN_SECRET` | 会话签名                                | **密钥**；必须替换 `replace-me-*`                              |
| `AUTH_PROVIDER`                               | `wechat` / `mock`                       | 生产必须 `wechat`                                              |
| `OPENID_HASH_PEPPER`                          | openid 哈希胡椒                         | **密钥**                                                       |
| `WECHAT_APP_ID`、`WECHAT_APP_SECRET`          | 小程序登录                              | 生产必填（不能用 `touristappid`）                              |
| `FEATURE_FLAGS`                               | 开关初始 JSON                           | 见 `specs/03` §Feature flags                                   |
| `OBJECT_STORAGE_BASE_URL`                     | 私有对象存储                            | 生产必须用真实 bucket；mock 适配器被拒绝                       |
| `OBJECT_STORAGE_SIGNING_SECRET`               | 签名 URL 的 HMAC 密钥                   | **密钥**                                                       |
| `VERIFICATION_METADATA_KEY`                   | 证件元数据封存密钥                      | **密钥**                                                       |
| `VERIFICATION_DOCUMENT_MAX_BYTES`             | 单文件上限                              | 可选，有默认值                                                 |
| `PAYMENT_PROVIDER`                            | `wechat` / `mock`                       | 生产必须 `wechat`（mock 被拒绝）                               |
| `WECHAT_PAY_*`                                | 商户号、API v3 密钥、商户私钥、回调地址 | **密钥**；`WECHAT_PAY_NOTIFY_URL` 必须是公网地址               |
| `ADMIN_API_BASE_URL`                          | 管理台在服务端调用的 API 地址           | 管理台部署必填（[`apps/admin`](../../apps/admin)）             |

`.env.example` 是模板；`.env` 不入库（`.gitignore`）。发布前用脚本或人工核对：
**任何 `replace-me-*` 出现在生产环境里，发布就不应该继续。**

## 3. Build

每个应用各自构建，互不依赖产物：

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm --filter @mentor/api build       # apps/api/dist
pnpm --filter @mentor/admin build     # apps/admin/.next
```

小程序不产出构建产物：用微信开发者工具上传 `apps/miniprogram`，**上传前**确认
`project.config.json` 里的 appid 是真实 appid（不是 `touristappid`），
`src/config.ts` 的 `apiOrigin` 指向目标环境。

## 4. Deploy order

1. **迁移先行**：`pnpm prisma:migrate`（`prisma migrate deploy`）。迁移必须是可
   加的或已验证可逆的；上一个版本的应用要能与新 schema 共存（`release-checklist.md`
   §Database）。
2. **后端**：发布新版本容器/服务；以 `GET /api/v1/health/ready` 作为放量闸门
   （返回 `database:"up"` 才接流量）。
3. **管理台**：部署新版；它只在服务端调用 API，不需要 CORS。
4. **小程序**：提交审核/发布。小程序是客户端，用户端升级是渐进的 —— **后端必须
   同时兼容新旧两端**，这是"先后端、后小程序"的原因。
5. **冒烟**：见 §5。
6. **观察**：`ops/monitoring.md` 的日志与告警，首个业务高峰后再确认一次。

## 5. Smoke after deploy

```bash
API_BASE_URL=https://api.example.com ops/smoke.sh
# 仅 mock 环境可额外探测登录：
API_BASE_URL=http://127.0.0.1:3000 ASK_LOGIN=1 ops/smoke.sh
```

脚本检查三项：进程应答（`/health`）、数据库应答（`/health/ready` 且
`database:"up"`）、可选登录探测。任一失败即以非 0 退出。

发布后还需人工确认（`release-checklist.md` §Rollout）：一笔真实订单旅程、一次
登录、一个被审计的管理动作。

## 6. Versioning and tags

- 提交信息：`feat|fix|chore|docs|test(scope): …`（`AGENTS.md` §14），一个任务一组提交。
- 里程碑标签：已存在的 `baseline-t024` 是"T024 完成"的锚点；每个可发布状态再打一个
  附注标签，例如 `git tag -a release-2026-10 -m "…"` 并推送。
- 标签只用于定位与回滚对比，**不承载任何密钥或配置**。
- 发布说明模板：

```markdown
## <版本 / 日期>

范围：<任务编号与一句话摘要>
迁移：<有 / 无；有则列出迁移名>
回滚：<上一个标签；迁移是否需要回滚脚本>
验收：<跑过的门禁命令与结果>
已知缺口：<未做的事>
```

## 7. Rollback

1. **先回滚应用，不回滚数据库**：迁移是加性的，旧版本应用通常可以继续跑；
   把服务切回上一个标签的构建（重新部署或切流）。
2. **确认**：`ops/smoke.sh`，再做一次登录与一笔订单只读核对。
3. **只有在数据层确实不兼容时才回滚迁移**，且必须先用
   [`backups.md`](./backups.md) 的流程做一次备份并演练恢复 —— 破坏性回滚比
   停机更贵。
4. **记录**：按 [`incident-response.md`](./incident-response.md) 留一份时间线，
   无论这次回滚是否算事故。

## 8. 当前发布准备状态

见 [`implementation/launch/launch-audit.md`](../../implementation/launch/launch-audit.md)：
本地 **READY FOR LOCAL LAUNCH**；生产 **READY AFTER FIXES**（L1 真实 appid、
L2 真实微信支付、L3 私有对象存储、L4 外部拨测与指标、L5 CI 上跑三端套件、
L6 多实例配 Redis）。

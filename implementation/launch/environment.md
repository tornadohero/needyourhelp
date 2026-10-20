# Local environment — 本地启动手册

面向"把项目在本机跑起来"的最小步骤。所有命令都在仓库根目录执行（除非另有说明）。
本手册只描述**本地开发**环境；生产相关流程见 `ops/`（备份、监控、告警、runbook、发布清单）。

## 0. 前置条件

| 依赖 | 版本 | 来源 |
|---|---|---|
| Node.js | `>=20`（仓库在 `node 20` 上验证） | 根 `package.json` `engines.node` |
| pnpm | `>=9`，锁定 `pnpm@9.15.9` | 根 `package.json` `packageManager`、`engines.pnpm` |
| PostgreSQL | 16（本地实测 `pg_isready` 接受连接） | 需自备；无 Docker Compose 编排 |
| Redis | **当前不需要** | `REDIS_URL` 仅在 `.env.example` 中出现，代码未使用（限流/幂等为单进程内存实现） |
| 微信开发者工具 | 仅查看小程序时 | `apps/miniprogram` 为占位应用 |

安装依赖：

```bash
pnpm install --frozen-lockfile
```

## 1. 环境变量

```bash
cp .env.example .env      # .env 已被 .gitignore 忽略，绝不入库
```

本地启动**必须**设置（其余保持模板默认值即可）：

| 变量 | 本地建议值 | 说明 |
|---|---|---|
| `NODE_ENV` | `local` | 非 local/test 时，mock 适配器会被拒绝 |
| `API_PORT` | `3000` | API 监听端口 |
| `DATABASE_URL` | `postgresql://…/mentor_platform?schema=public` | 开发库 |
| `DATABASE_TEST_URL` | `postgresql://…/mentor_platform_test?schema=public` | **一次性**测试库：集成/E2E 会重置它 |
| `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` | 任意本地字符串 | 生产用密钥管理器 |
| `OPENID_HASH_PEPPER` | 任意本地字符串 | openid 加盐哈希 |
| `AUTH_PROVIDER` | `mock` | `wechat` 需要 `WECHAT_APP_ID`/`WECHAT_APP_SECRET` |
| `PAYMENT_PROVIDER` | `mock` | `wechat` 需要微信支付全套密钥 |

数据库准备（会写入数据库，仅在你确认后执行）：

```bash
pnpm prisma:generate     # 生成 Prisma Client
pnpm prisma:migrate      # migrate deploy：把 3 个已提交迁移应用到 DATABASE_URL
pnpm prisma:seed         # 写入 feature flags、管理员/测试用户、taxonomy
```

## 2. 启动后端 `apps/api`

构建后启动（推荐，最快）：

```bash
pnpm --filter @mentor/api-contracts build   # 依赖的 workspace 包
pnpm --filter @mentor/shared build
pnpm --filter @mentor/api build             # nest build
pnpm --filter @mentor/api start:prod        # node dist/main.js
```

或开发模式：`pnpm --filter @mentor/api start`（`nest start`）。

> 已知环境坑：`nest build` 会先清空 `apps/api/dist/`（约 1100 个文件）。若你的终端/工具链启用了"批量删除保护"（单次删除阈值 500），`pnpm build` 会在 `apps/api` 这一步失败：
> `Error [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":1100,"threshold":500,...}`。
> 这不是代码缺陷。绕开方式：先手动清空 `apps/api/dist`，或直接用
> `cd apps/api && npx tsc -p tsconfig.build.json --outDir dist`。

验证（本轮实测结果）：

```bash
curl -s http://127.0.0.1:3000/api/v1/health
# → {"data":{"status":"ok","service":"api","env":"local",...}}

curl -s http://127.0.0.1:3000/api/v1/health/ready
# → {"data":{"status":"ok","database":"up","databaseLatencyMs":3,...}}   ← 数据库连通

curl -s -X POST http://127.0.0.1:3000/api/v1/auth/wechat/login \
  -H 'content-type: application/json' -d '{"code":"local-probe"}'
# → {"data":{"tokenType":"Bearer","accessToken":"…"}}                     ← mock 登录可用
```

`/health` 是存活探针，`/health/ready` 是就绪探针（真查库，库不可达时返回 503）。二者都不需要鉴权。

## 3. 启动管理台 `apps/admin`（当前为占位应用）

```bash
pnpm --filter @mentor/admin dev -- -p 3001    # 默认 3000 会与 API 冲突
```

- 现状：只有 `apps/admin/app/page.tsx` 一个占位页（自述 "No business modules are implemented yet."），
  `apps/admin/src/lib/api.ts` 仅 10 行（构造健康检查 URL），**没有登录、没有运营页面、没有 env 配置**。
- 若后续从浏览器直接调用 API，需要设置 `CORS_ALLOWED_ORIGINS`（如 `http://localhost:3001`），
  CORS 是 allowlist，未配置时浏览器源读不到响应（`src/common/security/cors-policy.ts`）。
- 后端侧运营**接口**已就绪：`apps/api/src/modules/admin/**`、`platform/**` 等（bootstrap、特性开关、
  平台规则、用户、订单、审计日志），并有集成测试覆盖。

## 4. 打开小程序 `apps/miniprogram`（T028 已完成工程初始化）

用微信开发者工具导入 `apps/miniprogram` 目录（微信负责编译与真机预览，本仓库不产出打包文件）：

```bash
pnpm --filter @mentor/miniprogram test        # 38 个单元测试（Node）
pnpm --filter @mentor/miniprogram typecheck   # tsc --noEmit
```

- 启动后端后，`src/config.ts` 保持 `env: 'develop'` 即指向 `http://localhost:3000`；
  体验版/正式版必须配置 `apiOrigin` 且为 HTTPS。
- 已完成：应用外壳与 5 个 Tab、启动时 `wx.login` 登录与会话刷新、发现页（公开导师列表）、
  错误码映射与金额/时间格式化。详见 `apps/miniprogram/README.md`。
- `project.config.json` 的 `appid` 仍是 `touristappid`（游客），**真机 `wx.login` 需替换为真实 AppID**。
- 未实现：下单/支付、订单、聊天、儿童档案、导师入驻等页面（见前端任务分解 FE-30 起）。

## 5. 验证与测试

```bash
pnpm lint           # eslint .
pnpm typecheck      # 全部工作区
pnpm test           # 单元测试（不连数据库）：实测 420 passed
```

以下两项**会重置 `DATABASE_TEST_URL` 指向的测试库**（`test/integration/global-setup.ts`
执行 `prisma migrate reset --force --skip-seed`），确认后再跑：

```bash
pnpm test:integration   # 43 文件（含 T024 的备份恢复演练）
pnpm test:e2e           # 8 条关键旅程（specs/14），整 AppModule 启动
```

一次性跑完 CI 等价流程：`pnpm verify`（lint → build → typecheck → test → integration → e2e）。

## 6. 运维脚本（本地可用）

```bash
DATABASE_URL='postgresql://…' PGPASSWORD='…' BACKUP_DIR=/tmp/mentor-backups ops/backup.sh
ops/restore.sh /tmp/mentor-backups/mentor-<timestamp>.dump 'postgresql://…/mentor_restore_check'
```

细节见 `ops/backups.md`、`ops/monitoring.md`、`ops/runbook.md`。

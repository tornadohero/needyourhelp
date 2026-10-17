# Repository Audit — 只读工程结构审计

审计时间：2026-10-12（本地 macOS）
审计范围：`/Users/zhangyang/Downloads/mentor-platform-spec-v1.0`
审计性质：**只读**。未修改任何代码、未创建目录、未改写 package.json、未改数据库 Schema、未安装依赖、未删除文件、未执行迁移/重置、未使用生产配置。

> 审计期间唯一产生的副作用及处置：为验证"能否本地启动"，启动了一次 `apps/api` 并调用 `POST /auth/wechat/login`，因此在本地开发库创建了 1 个用户/1 个会话/1 条角色；审计后已删除，开发库回到审计前状态（users=7 / sessions=0 / user_roles=14）。

---

## 1. Repository Structure

### 1.1 规范文件（第一步：逐项核对是否存在）

| 文件 | 状态 |
|---|---|
| `AGENTS.md` | 存在（288 行） |
| `README.md` | 存在（99 行） |
| `SPEC-INDEX.md` | 存在（25 行） |
| `specs/` | 存在，16 个文件：00–16 |
| `implementation/implementation-plan.md` | 存在（109 行） |
| `implementation/task-breakdown.md` | 存在（168 行，T001–T024） |

补充存在的文件：`implementation/progress.md`（2337 行，T001–T024 全部标记 done）、`tests/acceptance-tests.md`、`tests/api-contract-examples.md`、`implementation/launch/{environment.md, launch-audit.md, launch-progress.md}`（**三个文件均为 0 字节**）。

**关于"根目录没有 backend 文件夹"**：确认根目录下没有 `backend/`。但 `AGENTS.md` §5 与 `specs/03` 规定后端为 "NestJS + TypeScript"，`implementation/task-breakdown.md` T001 Output 明确列出 `apps/api`。因此**后端的目标目录就是 `apps/api`**，不存在名为 `backend` 的目录属于设计选择，不是后端缺失（见第 3 节证据）。

### 1.2 真实目录树（三层，已排除 `node_modules` / `dist` / `.next` 构建产物）

```text
.
├── AGENTS.md, README.md, SPEC-INDEX.md
├── package.json, pnpm-workspace.yaml, pnpm-lock.yaml, .npmrc
├── .env (未入库), .env.example (入库)
├── .github/workflows/ci.yml
├── eslint.config.mjs, .prettierrc.json, .editorconfig, tsconfig.base.json
├── apps
│   ├── admin
│   │   ├── package.json, next.config.mjs, tsconfig.json
│   │   ├── app/layout.tsx, app/page.tsx
│   │   └── src/lib/api.ts, src/lib/api.test.ts
│   ├── api                       ← 承担后端职责的应用
│   │   ├── package.json, nest-cli.json, tsconfig.json, tsconfig.build.json
│   │   ├── vitest.config.ts, vitest.integration.config.ts
│   │   ├── src/main.ts, src/app.module.ts, src/app.controller.ts
│   │   ├── src/common/{filters, http, idempotency, interceptors, middleware, monitoring, runtime, security}
│   │   ├── src/infrastructure/prisma/{prisma.module.ts, prisma.service.ts}
│   │   ├── src/modules/{admin, analytics, audit, auth, availability, catalog, compliance,
│   │   │               discovery, identity, messaging, moderation, orders, payments,
│   │   │               platform, profile, provider, refunds, reviews, services, verification}
│   │   └── test/{e2e, integration, modules, security, *.spec.ts}
│   └── miniprogram
│       ├── package.json, app.ts, app.json, app.wxss, project.config.json, sitemap.json, tsconfig.json
│       └── pages/index/{index.ts, index.wxml, index.wxss, index.json}
├── packages
│   ├── api-contracts
│   │   ├── package.json, tsconfig.json, tsconfig.build.json
│   │   └── src/{index, endpoints, envelope, error-codes, health, auth, profile, provider,
│   │            verification, compliance, catalog, services, discovery, availability, im,
│   │            orders, payments, refunds, reviews, moderation, admin, analytics}.ts
│   └── shared
│       ├── package.json, tsconfig.json, tsconfig.build.json
│       └── src/{index, ids, money}.ts + src/{ids, money}.test.ts
├── prisma
│   ├── schema.prisma, seed.ts, seed-data.ts
│   └── migrations/{20260929035555_init, 20260929070000_teacher_compliance_restriction,
│                   20260930123000_availability_slots_no_overlap, migration_lock.toml}
├── ops
│   ├── README.md, backups.md, monitoring.md, runbook.md, incident-response.md, release-checklist.md
│   ├── alert-rules.yml
│   └── backup.sh, restore.sh
├── tests/{acceptance-tests.md, api-contract-examples.md}
└── implementation/{implementation-plan.md, task-breakdown.md, progress.md, launch/}
```

### 1.3 承担后端职责的应用目录识别

**`apps/api`**（package name `@mentor/api`）。判定依据：`src/main.ts` 是 NestJS bootstrap 入口；`src/app.module.ts` 注册 21 个业务模块；`apps/api/package.json` 依赖 `@nestjs/*`、`@prisma/client`、`class-validator`。详见第 3 节。

---

## 2. Workspace Configuration

### 2.1 事实

| 文件 | 内容要点 |
|---|---|
| `pnpm-workspace.yaml` | `packages: - 'apps/*'  - 'packages/*'` |
| 根 `package.json` | `private: true`，`packageManager: pnpm@9.15.9`，**无 `workspaces` 字段**（pnpm 用 `pnpm-workspace.yaml`，无需该字段） |
| `.npmrc` | `auto-install-peers=true`、`strict-peer-dependencies=false`、`save-workspace-protocol=rolling` |
| `pnpm-lock.yaml` | `lockfileVersion: '9.0'`，`importers:` 段包含 `.`、`apps/*`、`packages/*` |

### 2.2 逐问回答

1. **当前是否为有效的 pnpm Monorepo？** — **是。** 证据：`pnpm --version` = 9.15.9；`pnpm -r list --depth -1` 输出 5 个工作区包：`@mentor/admin`、`@mentor/api`、`@mentor/miniprogram`、`@mentor/api-contracts`、`@mentor/shared`（含根 `mentor-platform`）。
2. **`pnpm-workspace.yaml` 是否正确？** — **是。** 两条 glob 精确覆盖 `apps/*` 与 `packages/*`，与磁盘目录一致；lockfile 的 importers 与之匹配。
3. **apps 下的应用是否被识别？** — **是（3/3）。** `apps/api`、`apps/admin`、`apps/miniprogram` 均出现在 `pnpm -r list` 输出中；`apps/api/node_modules/@mentor/{api-contracts,shared}` 为指向 `packages/*` 的软链，证明 workspace 协议 `workspace:*` 已解析。
4. **packages 下的包是否被识别？** — **是（2/2）。** `@mentor/api-contracts`、`@mentor/shared` 均被识别，且 `api-contracts/dist/index.js`、`shared/dist/index.js` 已构建。
5. **是否存在缺失 package.json 的应用目录？** — **否。** `apps/*` 三个目录与 `packages/*` 两个目录均有 `package.json`；未发现"有目录无清单"的情况。
6. **是否存在重复或冲突的依赖声明？** — **存在重复声明（不冲突，属常见做法）。** `typescript ^5.6.3`、`vitest ^2.1.0`、`@types/node ^22.10.0` 在根与多个工作区包中分别声明；`@prisma/client ^5.22.0` 同时出现在根 `devDependencies` 与 `apps/api/dependencies`；`@mentor/api-contracts`、`@mentor/shared` 以 `workspace:*` 声明于 `apps/api` 与 `apps/admin`。未发现同一包的不同大版本冲突（lockfile 解析正常）。
7. **根目录 scripts 是否引用了实际存在的工作区包？** — **是。** `test`/`build`/`typecheck` 通过 `pnpm -r` 递归执行，不按名字硬引用；`typecheck` 的 `--filter "./packages/**"` 命中真实存在的 `packages/api-contracts`、`packages/shared`；`test:integration`、`test:e2e` 用 `--if-present` 仅在 `apps/api` 命中；`prisma:*` 指向根 `prisma/schema.prisma` 与 `prisma/seed.ts`（均存在）。
8. **根 `build`、`test`、`typecheck`、`lint` 是否能执行？** — 本轮实测：
   - `pnpm lint` → **通过**（`eslint .`，无输出即无问题）。
   - `pnpm typecheck` → **通过**（packages/api-contracts、packages/shared、apps/api、apps/admin 全部 `Done`）。
   - `pnpm test` → **通过**：`apps/api 405 passed / 50 files`；`packages/api-contracts 5 passed`；`packages/shared 8 passed`；`apps/admin 2 passed`（合计 420）。
   - `pnpm build` → **本环境下失败，但非代码原因**：`apps/api build$ nest build` 被环境的批量删除保护拦截 —— `Error [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":1100,"threshold":500,...,"targets":["apps/api/dist"]}`。`nest build` 会先清空 `dist/`（1100 个文件），超过本会话的单次删除阈值 500 而被阻断。CI（`.github/workflows/ci.yml`）无此保护，不受影响；本地可用 `tsc -p tsconfig.build.json --outDir dist` 或先清空 `dist` 绕开。

---

## 3. Backend Implementation Status

### 结论：**A — 后端已经实现，只是目录名称不同（位于 `apps/api`）**

| 检查项 | 证据（真实路径） | 结果 |
|---|---|---|
| NestJS bootstrap entry | `apps/api/src/main.ts`（`NestFactory.create(AppModule, { rawBody: true })`、`app.listen(port)`） | ✅ |
| AppModule | `apps/api/src/app.module.ts`（导入 21 个业务模块 + `PrismaModule`，注册全局中间件） | ✅ |
| Controllers | 27 个 `*.controller.ts`，如 `src/modules/orders/http/order.controller.ts`、`src/modules/admin/http/admin.controller.ts` | ✅ |
| Services | 26 个 `*.service.ts`，如 `src/modules/orders/application/order.service.ts` | ✅ |
| Modules | 23 个 `*.module.ts`（21 个业务模块 + `PrismaModule` + …） | ✅ |
| Authentication | `src/modules/auth/http/auth.controller.ts`、`domain/auth.service.ts`、`domain/access-token.service.ts`、`infrastructure/jwt-access-token.service.ts`、`infrastructure/{mock,wechat-http}-auth.provider.ts` | ✅ |
| Authorization guards | `src/modules/auth/http/guards/{jwt-auth.guard.ts, roles.guard.ts, optional-jwt-auth.guard.ts, bearer-token.ts}`、`roles.decorator.ts` | ✅ |
| Prisma Client integration | `src/infrastructure/prisma/{prisma.module.ts, prisma.service.ts}`；42 个 `*repository*.ts` 适配器（如 `src/modules/orders/infrastructure/prisma-order.repository.ts`） | ✅ |
| **Redis integration** | **缺失**：全仓 `src/` 与 `package.json` 无 `redis`/`ioredis` 依赖；`REDIS_URL` 仅出现在 `.env.example`（第 13 行），代码中零引用。限流用 `src/common/security/in-memory-rate-limiter.ts`，幂等用 `src/common/idempotency/in-memory-idempotency.store.ts`，二者注释均写明"Redis 版属于 T022/后续" | ❌（单实例可运行，多实例不可用；与 `AGENTS.md` §5 和 README 的"Redis 用于缓存/幂等/锁"不符） |
| DTO / validation | 16 个 `*.dto.ts` + `class-validator`/`class-transformer` + `main.ts` 的全局 `ValidationPipe{whitelist, forbidNonWhitelisted, transform}` | ✅ |
| Exception handling | `src/common/filters/all-exceptions.filter.ts`（`main.ts` 注册为全局过滤器） | ✅ |
| Health endpoint | `src/app.controller.ts`：`GET /health`（存活）、`GET /health/ready`（就绪，真查库） | ✅ |
| API version prefix | `main.ts:39` `app.setGlobalPrefix(API_BASE.replace(/^\/+/, ''))`，`API_BASE` 来自 `packages/api-contracts` | ✅ |
| CORS configuration | `src/common/security/cors-policy.ts` + `main.ts` `app.enableCors(...)`（allowlist，`CORS_ALLOWED_ORIGINS` 驱动） | ✅ |
| Environment configuration | `ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] })`（`app.module.ts`）；`.env.example` 覆盖 DB/Auth/对象存储/支付/特性开关 | ✅ |
| Backend tests | `apps/api/test/modules/**`（单元，405 通过）、`apps/api/test/integration/**`（43 文件）、`apps/api/test/e2e/**`（8 条旅程）、`apps/api/test/security/**` | ✅ |
| 领域策略/状态机 | 18 个 `*policy*.ts`（如 `src/modules/orders/domain/order-policy.ts`、`src/modules/refunds/domain/refund-policy.ts`） | ✅ |

**运行时验证（本轮实测，使用本地 `.env`，非生产配置）**：
- `node apps/api/dist/main.js` 启动成功；`GET /api/v1/health` → `200`；
- `GET /api/v1/health/ready` → `200`，body `{"status":"ok","database":"up","databaseLatencyMs":3,"env":"local"}`，证明 Prisma 与本地 PostgreSQL 连通；
- `POST /api/v1/auth/wechat/login`（`AUTH_PROVIDER=mock`）→ `200`，返回 `accessToken`。

---

## 4. Admin Implementation Status

### 结论：**T001 占位应用，未实现**

| 检查项 | 证据 | 结果 |
|---|---|---|
| 应用目录 | `apps/admin` | ✅ 存在 |
| package.json | `apps/admin/package.json`（`@mentor/admin`，依赖 `next ^15.1.0`、`react ^19`） | ✅ |
| 启动脚本 | `"dev": "next dev"`、`"build": "next build"`、`"start": "next start"` | ✅ |
| 应用入口 | `apps/admin/app/layout.tsx`（15 行）、`apps/admin/app/page.tsx`（16 行） | ⚠️ 仅根目录页 |
| API client | `apps/admin/src/lib/api.ts`（10 行）：仅 `resolveApiBaseUrl()`（硬编码默认 `http://localhost:3000`）与 `healthEndpointUrl()` | ⚠️ 仅一个健康检查 URL 构造器，无鉴权、无请求封装、无业务调用 |
| 环境配置 | `apps/admin` 内无任何 `process.env` / `NEXT_PUBLIC_*` 引用；`next.config.mjs` 仅 `reactStrictMode`、`poweredByHeader` | ❌ 无 API 地址/env 配置 |
| 页面 | 仅 `app/page.tsx`，其文案自述：`"Repository bootstrap (T001). No business modules are implemented yet."` | ❌ 无运营页面 |
| 与后端连接 | 页面只把 URL 当字符串打印，**运行时不发起任何请求** | ❌ 未建立连接 |

对照 `specs/11-pages-and-ui.md` §Admin Web（Dashboard、Provider review、Orders、Moderation、Platform configuration）与 `specs/12-admin-spec.md`：需要的 5 类页面在 `apps/admin` 中**全部不存在**。

**后端侧 admin 能力已实现**（`apps/api/src/modules/admin/**`、`platform/http/admin-platform.controller.ts`、`compliance/http/admin-compliance.controller.ts`、`provider/http/admin-provider.controller.ts`、`moderation/http/admin-moderation.controller.ts`），并有 `test/integration/admin-operations-http.spec.ts`、`admin-platform-http.spec.ts` 覆盖 —— 即"接口在、界面不在"。

---

## 5. Mini Program Implementation Status

### 结论：**T001 占位应用，未实现**

| 检查项 | 证据 | 结果 |
|---|---|---|
| 应用目录 | `apps/miniprogram` | ✅ 存在 |
| package.json | `apps/miniprogram/package.json`（`@mentor/miniprogram`） | ✅ |
| 启动脚本 | 仅有 `"build": "tsc --noEmit"`、`"typecheck"`；**无 `dev`/`start`** | ⚠️ 无启动脚本（微信开发者工具打开目录即可预览） |
| 应用入口 | `apps/miniprogram/app.ts`（7 行）：`globalData.apiBase`，`onLaunch` 注释 "T001 bootstrap only" | ⚠️ 占位 |
| API client | 全仓 `apps/miniprogram` 无 `wx.request`、无 `apiBase` 使用、无 `packages/api-contracts` 依赖 | ❌ 不存在 |
| 环境配置 | `project.config.json`：`"appid": "touristappid"` —— 游客 appid，**无法调用 `wx.login` 换取真实 code** | ❌ |
| 页面 | `pages/index/` 一个页面；`app.json` 仅注册该页；`pages/index/index.ts` 文案："T001 bootstrap only — no business modules yet." | ❌ |
| 与后端连接 | 无任何网络调用代码 | ❌ 未建立连接 |

对照 `specs/11-pages-and-ui.md`（Parent pages / Provider pages / Career pages）与 README "Client: WeChat Mini Program"：需要的页面一个都不存在。另需说明：`implementation/task-breakdown.md` 的 T001–T024 中**没有任何一条任务要求实现小程序页面或管理台页面**（T019 "Implement all operations pages" 在实际执行中被解释为后端接口，见 `implementation/progress.md` T019 行）。这是**任务分解覆盖不到的范围**，而非某个任务失败。

---

## 6. Database Status

| 项 | 证据 | 状态 |
|---|---|---|
| Schema | `prisma/schema.prisma`，28 个 `model` | ✅ |
| 迁移 | `prisma/migrations/`：`20260929035555_init`、`20260929070000_teacher_compliance_restriction`、`20260930123000_availability_slots_no_overlap` + `migration_lock.toml` | ✅ 3 个已提交迁移 |
| Seed | `prisma/seed.ts`、`prisma/seed-data.ts`；根 `package.json` 的 `prisma.seed` = `tsx prisma/seed.ts` | ✅ |
| 本地 PostgreSQL | `pg_isready` → `localhost:5432 - 接受连接`；库 `mentor_platform`、`mentor_platform_test` 均存在 | ✅ |
| 开发库内容 | users=7、user_roles=14、sessions=0、feature_flags=6、taxonomy_terms=28、orders/payments/refunds/reviews=0（已 seed，无业务数据） | ✅ 可用于本地启动 |
| 连通性 | 通过应用验证：`GET /health/ready` → `database: "up"` | ✅ |
| 本轮操作 | **未执行 migrate / reset / seed**；仅做只读查询与审计后清理自身产生的 1 条数据 | 符合约束 |

---

## 7. Test Status

| 套件 | 命令 | 本轮是否执行 | 结果 |
|---|---|---|---|
| 单元（全部工作区） | `pnpm test` | ✅ 已执行 | `apps/api` 405 passed / 50 files；`packages/api-contracts` 5；`packages/shared` 8；`apps/admin` 2（合计 **420 passed**） |
| 集成（含恢复演练） | `pnpm test:integration` | ❌ **未执行**（该套件会 `prisma migrate reset --force` 重置测试库，本次审计明确禁止数据库重置） | 既有记录（T024 完成时，`implementation/progress.md`）：**274 passed / 43 files**；现有 43 个集成 spec 文件仍在磁盘上 |
| E2E（8 条旅程） | `pnpm test:e2e` | ❌ **未执行**（同上，复用同一测试库） | 既有记录：**8 passed / 8 files**；`apps/api/test/e2e/e2e-01…e2e-08` 均在 |
| Lint | `pnpm lint` | ✅ 已执行 | 通过（无告警） |
| Typecheck | `pnpm typecheck` | ✅ 已执行 | 通过（4 个工作区包） |
| Build | `pnpm build` | ✅ 已执行 | `apps/api` 步骤被环境批量删除保护拦截（非代码缺陷），见 §2.2.8 |
| CI | `.github/workflows/ci.yml` | ❌ 未在 CI 上重跑 | 流水线已配置：format → lint → generate → build → typecheck → test → migrate → seed → integration → **pg client 安装** → integration → **E2E** |

**严格遵守：未执行的测试一律不标记为 PASS。** 下表中"本轮测试状态"列区分 `EXECUTED-PASS` 与 `NOT-EXECUTED(recorded)`。

---

## 8. T001–T024 实现完整性矩阵

图例：状态 = 依据**文件 + 测试证据**对"任务验收标准"的判断；本轮测试 = 本次审计是否真的跑过测试。

| Task | 预期交付物（task-breakdown 原文） | 实际文件（节选） | 测试证据 | 本轮测试状态 | 状态 |
|---|---|---|---|---|---|
| T001 | pnpm workspace、apps/api、apps/admin、apps/miniprogram、packages/shared、packages/api-contracts、CI | `pnpm-workspace.yaml`；5 个 `package.json`；`.github/workflows/ci.yml`；`eslint.config.mjs`；`.prettierrc.json` | `apps/admin/src/lib/api.test.ts`(2)、`packages/shared/src/*.test.ts`(8) | EXECUTED-PASS | **PASS** |
| T002 | Prisma schema、迁移、seed taxonomy | `prisma/schema.prisma`(28 models)、`prisma/migrations/*3`、`prisma/seed.ts`、`prisma/seed-data.ts` | `test/integration/migration.spec.ts`、`seed.spec.ts` | NOT-EXECUTED(recorded 274/43 含此二者) | **PASS** |
| T003 | 微信登录适配器接口 + mock provider | `src/modules/auth/**`（19 文件：`jwt-access-token.service.ts`、`mock-wechat-auth.provider.ts`、`wechat-http-auth.provider.ts`、`guards/*`） | `test/integration/auth-http.spec.ts`、`auth-session.spec.ts`；运行时冒烟：登录返回 token | NOT-EXECUTED(recorded) | **PASS** |
| T004 | user/profile/consent/child | `src/modules/profile/**`(17)、`src/modules/identity/**` | `profile-http.spec.ts`、`profile-repository.spec.ts`、`test/modules/profile/*`；E2E-06 | NOT-EXECUTED(recorded) | **PASS** |
| T005 | provider profile/capabilities/application | `src/modules/provider/**`(18) | `provider-http.spec.ts`、`provider-repository.spec.ts`；E2E-02 | NOT-EXECUTED(recorded) | **PASS** |
| T006 | 验证用例/文档/状态 + mock 网关 | `src/modules/verification/**`(19) | `verification-http.spec.ts`、`verification-repository.spec.ts` | NOT-EXECUTED(recorded) | **PASS** |
| T007 | 可配置合规状态/限制 | `src/modules/compliance/**`(9) | `compliance-http.spec.ts`、`compliance-repository.spec.ts`；E2E-03 | NOT-EXECUTED(recorded) | **PASS** |
| T008 | city/grade/subject/skill 词条 + 管理员 CRUD | `src/modules/catalog/**`(11) | `taxonomy-admin-http.spec.ts`、`taxonomy-admin-repository.spec.ts`、`taxonomy-repository.spec.ts` | NOT-EXECUTED(recorded) | **PASS** |
| T009 | 商家服务 + 发布状态机 | `src/modules/services/**`(13) | `services-http.spec.ts`、`services-repository.spec.ts` | NOT-EXECUTED(recorded) | **PASS** |
| T010 | 列表/详情/搜索/过滤 | `src/modules/discovery/**`(10) | `discovery-http.spec.ts`、`discovery-directory.spec.ts` | NOT-EXECUTED(recorded) | **PASS** |
| T011 | 可预约时段（无重叠） | `src/modules/availability/**`(11) | `availability-http.spec.ts`、`availability-repository.spec.ts`（含竞态用例） | NOT-EXECUTED(recorded) | **PASS** |
| T012 | IM 抽象 + mock 适配器 + block/report | `src/modules/messaging/**`(17) | `messaging-http.spec.ts`、`messaging-repository.spec.ts` | NOT-EXECUTED(recorded) | **PASS** |
| T013 | 订单聚合与状态机（禁止直接 PATCH） | `src/modules/orders/**`(11) | `orders-http.spec.ts`、`orders-repository.spec.ts`；E2E-01 | NOT-EXECUTED(recorded) | **PASS** |
| T014 | 支付会话 + mock 网关 + 幂等/重放 | `src/modules/payments/**`(mock gateway)、`src/common/idempotency/**` | `payments-http.spec.ts`、`payments-repository.spec.ts`；E2E-04 | NOT-EXECUTED(recorded) | **PASS** |
| T015 | 微信支付生产适配器（密钥外置） | `src/modules/payments/infrastructure/wechat/{wechat-payment.gateway.ts, wechat-notification.verifier.ts, wechat-pay-config.ts, wechat-pay-crypto.ts, wechat-certificate.provider.ts}` | `test/modules/payments/*`、`payments-http.spec.ts`（未发起真实微信调用） | NOT-EXECUTED(recorded) | **PASS**（仅限代码与配置外置；真实联调未验证） |
| T016 | 退款策略引擎 + 工作流 | `src/modules/refunds/**`(12) | `refunds-http.spec.ts`、`refunds-repository.spec.ts`；E2E-08 | NOT-EXECUTED(recorded) | **PASS** |
| T017 | 完成/资格/评价 | `src/modules/reviews/**`(12) | `reviews-http.spec.ts`、`reviews-repository.spec.ts`；E2E-01 | NOT-EXECUTED(recorded) | **PASS** |
| T018 | 举报/屏蔽/审核状态机 + 上诉 | `src/modules/moderation/**`(11) | `moderation-http.spec.ts`、`moderation-repository.spec.ts` | NOT-EXECUTED(recorded) | **PASS** |
| T019 | **"Implement all operations pages"**（验收：MVP 无需直接改库即可运行） | 后端：`src/modules/admin/**`(11)、`src/modules/platform/**`(12)（bootstrap、特性开关、平台规则、用户、订单、审计日志）；**前端：`apps/admin/app/page.tsx` 仅 T001 占位页** | `admin-operations-http.spec.ts`、`admin-platform-http.spec.ts` | NOT-EXECUTED(recorded) | **PARTIAL** — 运营"接口"齐备并可审计启动，**运营"页面"未实现**（`specs/11` §Admin Web 的 5 类页面全缺） |
| T020 | 事件抽象 + 核心漏斗事件 | `src/modules/analytics/**`(7，含 `domain/analytics-policy.ts`、`infrastructure/logging-analytics-sink.ts`) | `analytics-http.spec.ts` | NOT-EXECUTED(recorded) | **PASS** |
| T021 | 职业导师能力与服务（开关） | `FEATURE_FLAGS.careerMarketplace = 'career_marketplace_enabled'`（`src/modules/platform/infrastructure/prisma-feature-flag.repository.ts:34`）；`discovery`/`provider`/`verification`/`availability` 中的 career 分支 | `career-http.spec.ts` | NOT-EXECUTED(recorded) | **PASS** |
| T022 | 限流、安全头、字段级 DTO、私有对象访问 | `src/common/security/*`（11 文件：`rate-limit.*`、`security-headers.middleware.ts`、`cors-policy.ts`、`request-size-limit.middleware.ts`、`hash.ts`、`seal.ts`） | `test/integration/security-http.spec.ts`、`test/security/{hash,seal}.spec.ts`、`test/modules/security/security.spec.ts` | 单元部分 EXECUTED-PASS（含于 405）／集成 NOT-EXECUTED(recorded) | **PASS**（单实例正确；Redis 版限流/幂等未实现，见 §3） |
| T023 | 测试策略中的所有 E2E | `apps/api/test/e2e/e2e-01…e2e-08.spec.ts` + `helpers/e2e.ts`（整 `AppModule` 启动） | `pnpm test:e2e` 脚本 + CI 步骤；既有记录 8 passed | NOT-EXECUTED(recorded) | **PASS** |
| T024 | 备份 / 恢复测试 / 监控 / 告警 / runbook / 事故响应 / 发布清单 | `ops/{README,backups,monitoring,runbook,incident-response,release-checklist}.md`、`ops/alert-rules.yml`、`ops/backup.sh`、`ops/restore.sh`；`src/common/monitoring/access-log.middleware.ts`、`src/app.controller.ts`(ready) | `test/integration/backup-restore.spec.ts`、`ops-http.spec.ts`（单元部分本轮已跑）；`backup.sh`/`restore.sh` 语法检查通过 | 单元 EXECUTED-PASS／恢复演练 NOT-EXECUTED(recorded) | **PASS** |

矩阵统计：**PASS 23 / PARTIAL 1（T019，页面缺失）/ FAIL 0**，其中所有 PASS 的"测试证据"里，本轮真正重跑过的只有单元测试（420）与 lint/typecheck；集成与 E2E 为既有记录，本次未重跑。

---

## 9. Critical Blockers

| # | 阻塞项 | 严重度 | 证据 |
|---|---|---|---|
| B1 | **管理台无任何运营页面**（只有 T001 占位页），`specs/11` §Admin Web 与 `specs/12` 要求的 Dashboard/Provider review/Orders/Moderation/Platform config 全缺；且 admin 无 env 配置、无鉴权、无请求封装 | 高（产品不可用） | `apps/admin/app/page.tsx:7` 自述 "No business modules are implemented yet"；`apps/admin/src/lib/api.ts` 仅 10 行；`apps/admin` 无 `process.env` 引用 |
| B2 | **小程序无任何业务页面与 API client**，appid 为 `touristappid`，无法真实登录 | 高（产品不可用） | `apps/miniprogram/project.config.json:17`；`app.ts` 7 行；`pages/index/index.ts`；全目录无 `wx.request` |
| B3 | **Redis 未接入**（`AGENTS.md` §5 与 README 要求用于缓存/幂等/锁）；限流与幂等均为单进程内存实现 | 高（生产）/ 中（本地单实例可跑） | `src/common/security/in-memory-rate-limiter.ts`、`src/common/idempotency/in-memory-idempotency.store.ts`；无 `ioredis` 依赖；`REDIS_URL` 仅存在于 `.env.example:13` |
| B4 | **T002–T024 全部工作未提交**，仓库仅 7 个提交且最后一个是 T001；工作区 52 项改动 | 高（可复现性/协作/CI） | `git rev-list --count HEAD` = 7；`git log --oneline` 末条 `6ea7627 chore(repo): bootstrap monorepo for T001`；`git status --short` = 52 |
| B5 | **本环境下 `pnpm build` 无法完成**（`nest build` 清空 `dist/` 触发批量删除保护） | 中（本地）/ 无（CI） | `Error [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":1100,"threshold":500,...}` |
| B6 | **集成/E2E 本轮未重跑**，最新证据来自 `progress.md` 记录；两者都会重置测试库，审计约束下无法验证 | 中（证据时效） | `apps/api/test/integration/global-setup.ts` 执行 `prisma migrate reset --force --skip-seed` |
| B7 | **无 `/metrics` 端点与外部拨测**，告警规则依赖外部采集器 | 中（生产可观测性） | `ops/monitoring.md` 说明；`src` 中无 metrics 路由；`ops/alert-rules.yml` 为 Prometheus 规则文本 |
| B8 | `implementation/launch/{environment.md, launch-audit.md, launch-progress.md}` 均为 **0 字节**，本地启动文档尚未编写 | 中（本次启动工作） | `ls -la implementation/launch/` 三个文件 size=0 |
| B9 | 小程序/管理台在 `task-breakdown.md` 中**没有对应任务**，范围缺口不在任务列表内 | 中（计划层） | `implementation/task-breakdown.md` T001–T024 全文无 mini program/admin UI 任务 |

---

## 10. Recommended Next Steps（仅建议，本轮不执行）

按"先能跑、再能验、再补全"排序：

1. **固化代码**：提交 T002–T024（按 `AGENTS.md` §14 拆分为小逻辑提交），避免工作区 52 项改动暴露在丢失风险中。
2. **绕开/确认 B5**：本地构建前先清空 `apps/api/dist`，或改用 `tsc -p tsconfig.build.json --outDir dist`；确认 CI（无 safe-delete 保护）上 `pnpm build` 仍为绿。
3. **补一次全量验证**：在允许重置测试库的前提下跑 `pnpm test:integration` 与 `pnpm test:e2e`，把 §7 中 `NOT-EXECUTED(recorded)` 升级为 `EXECUTED`，使矩阵具备当期证据。
4. **编写 `implementation/launch/environment.md`**：本地启动前置（PostgreSQL 16、可选 Redis、`cp .env.example .env`、`pnpm prisma:generate/migrate/seed`、`pnpm --filter @mentor/api start:prod`、`pnpm --filter @mentor/admin dev`、小程序用开发者工具打开 `apps/miniprogram`），并明确 `AUTH_PROVIDER=mock`、`PAYMENT_PROVIDER=mock` 仅限本地。
5. **为 Redis 做决策**：要么在单实例本地发行中显式降级为"内存适配器"（需与 `AGENTS.md` §5 形成书面偏差记录），要么按端口实现 Redis 版限流器与幂等存储（`RateLimiter` / `IdempotencyStore` 端口已存在，替换适配器即可）。
6. **补范围缺口（B1/B2/B9）**：新增任务（如 T025 管理台页面、T026 小程序页面），以 `specs/11` 与 `specs/12` 为验收源；管理台应先接入 `NEXT_PUBLIC_API_BASE_URL`、登录与 `GET /admin/*` 接口，并确认 CORS allowlist 包含管理台来源。
7. **小程序联调前置**：申请真实 appid 替换 `touristappid`，实现 `wx.login` → `POST /api/v1/auth/wechat/login` 的 API client。

---

## 最终结论

### 总体结论：**READY AFTER FIXES**

分应用结论（每个结论都附本轮证据）：

| 范围 | 结论 | 依据 |
|---|---|---|
| **仓库/Workspace** | **READY AFTER FIXES** | pnpm 9.15.9 识别 5 个工作区包；`pnpm-workspace.yaml` 正确；`lint`/`typecheck`/`test` 本轮实测通过（420 单测）；`build` 在本环境被删除保护拦截（B5），需清空 `dist` 或换命令 |
| **后端 `apps/api`** | **READY FOR LOCAL LAUNCH** | 本轮实测：`node apps/api/dist/main.js` 启动 → `/api/v1/health` 200 → `/api/v1/health/ready` 200 且 `database:"up"` → mock 登录返回 token；27 控制器/26 服务/23 模块/42 仓储/3 守卫/全局校验与异常过滤/API 前缀/CORS 齐备 |
| **数据库** | **READY** | PostgreSQL 本地在跑，`mentor_platform` 已 seed（7 用户/28 词条/6 开关）；3 个迁移已提交；未执行任何迁移或重置 |
| **管理台 `apps/admin`** | **NOT READY** | 仅 `app/page.tsx` 占位页（自述未实现业务模块），API client 10 行、无 env、无鉴权、无运营页面（B1） |
| **小程序 `apps/miniprogram`** | **NOT READY** | 单页占位、`touristappid`、无 API client、无 `wx.login`（B2） |

**判定说明**：如果"本地启动"指**后端 API 本地可启动并可被验证**（`AGENTS.md` §5 的模块化单体 + PostgreSQL），则证据支持启动，只需处理 B5（构建产物清理）与 B4（提交代码）两项工程性修复，其余 PASS 项的集成/E2E 证据来自既有记录（B6），建议在允许重置测试库时补跑一次。如果"本地启动"指**README 描述的三端产品**（小程序 + 管理台 + 后端）可端到端跑通，则答案降级为 **NOT READY**：小程序与管理台都停留在 T001 占位状态，且 `task-breakdown.md` 中根本没有对应任务（B9）——这不是缺陷，而是尚未纳入计划的实现范围。

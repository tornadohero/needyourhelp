# Local environment — 本地启动手册

面向"把项目在本机跑起来"的最小步骤。所有命令都在仓库根目录执行（除非另有说明）。
本手册只描述**本地开发**环境；生产相关流程见 `ops/`（备份、监控、告警、runbook、发布准备）。
最近一次全面核对：T036（三端联调通过后）。

## 0. 前置条件

| 依赖 | 版本 | 来源 |
|---|---|---|
| Node.js | `>=20`（仓库在 `node 20` 上验证） | 根 `package.json` `engines.node` |
| pnpm | `>=9`，锁定 `pnpm@9.15.9` | 根 `package.json` `packageManager`、`engines.pnpm` |
| PostgreSQL | 16（本地实测 `pg_isready` 接受连接） | 需自备；无 Docker Compose 编排 |
| Redis | **可选**（多实例必需） | `REDIS_URL` 已接入（T034）：限流计数与幂等键；未配置时自动降级为单进程内存实现 |
| 微信开发者工具 | 运行/预览小程序时 | `apps/miniprogram` |

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
| `DATABASE_TEST_URL` | `postgresql://…/mentor_platform_test?schema=public` | **一次性**测试库：集成/E2E/三端会重置它 |
| `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` | 任意本地字符串 | 生产用密钥管理器 |
| `OPENID_HASH_PEPPER` | 任意本地字符串 | openid 加盐哈希 |
| `AUTH_PROVIDER` | `mock` | `wechat` 需要 `WECHAT_APP_ID`/`WECHAT_APP_SECRET` |
| `PAYMENT_PROVIDER` | `mock` | `wechat` 需要微信支付全套密钥 |

管理台额外一项（服务端读取，不会进入浏览器包）：

| 变量 | 本地建议值 | 说明 |
|---|---|---|
| `ADMIN_API_BASE_URL` | `http://127.0.0.1:3000` | 管理台在服务端调用 API 的地址 |

数据库准备（会写入数据库，仅在你确认后执行）：

```bash
pnpm prisma:generate     # 生成 Prisma Client
pnpm prisma:migrate      # migrate deploy：把已提交迁移应用到 DATABASE_URL
pnpm prisma:seed         # 写入 feature flags、管理员/测试用户、taxonomy
```

## 2. 启动后端 `apps/api`

构建后启动（推荐，最快）：

```bash
pnpm --filter @mentor/shared build
pnpm --filter @mentor/api build             # nest build
pnpm --filter @mentor/api start:prod        # node dist/main.js
```

或开发模式：`pnpm --filter @mentor/api start`（`nest start`）。

> 已知环境坑：`nest build` 会先清空 `apps/api/dist/`（约 1100 个文件）。若你的终端/工具链启用了"批量删除保护"（单次删除阈值 500），`pnpm build` 会在 `apps/api` 这一步失败：
> `Error [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":1100,"threshold":500,...}`。
> 这不是代码缺陷。绕开方式：先手动清空 `apps/api/dist`，或直接用
> `cd apps/api && npx tsc -p tsconfig.build.json --outDir dist`。

验证：

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
发布后可用 `ops/smoke.sh` 一次跑完这两项（外加可选登录探测）。

## 3. 启动管理台 `apps/admin`

```bash
ADMIN_API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @mentor/admin dev -- -p 3001
```

- 默认端口 3000 会与 API 冲突，本地用 3001。
- 管理台在**服务端**调用 API（server components / server actions），令牌只存在 httpOnly cookie 里，
  因此**不需要 CORS**，浏览器也拿不到令牌。
- 运营页面：登录、概览、商家审核、验证队列（含证件签名 URL）、订单与幂等退款、用户与角色、
  审计日志、特性开关、类目、平台规则（T033）。
- 首次进入需要一个运营账号：见 §5 首次运行走查的第 2 步（bootstrap）。

## 4. 打开小程序 `apps/miniprogram`

用微信开发者工具导入 `apps/miniprogram` 目录（微信负责编译与真机预览，本仓库不产出打包文件）：

```bash
pnpm --filter @mentor/miniprogram test        # 214 个单元测试（Node）
pnpm --filter @mentor/miniprogram typecheck   # tsc --noEmit
```

- 启动后端后，`src/config.ts` 保持 `env: 'develop'` 即指向 `http://localhost:3000`；
  体验版/正式版必须配置 `apiOrigin` 且为 HTTPS。
- 页面：家长端（首页、发现、导师详情、预约、支付、订单、我的）、
  导师端（工作台、服务、时段、接单、评价、验证）。
- `project.config.json` 的 `appid` 仍是 `touristappid`（游客），**真机 `wx.login` 需替换为真实 AppID**。
- 支付本地走 mock：`wx.requestPayment` 只在服务端下发了签名时才打开；mock 场景改用页面上的
  "模拟支付（仅本地）"，结果仍以 `GET /orders/:id/payment-status` 为准。

## 5. 首次运行走查（从空库到一笔完成并退款的订单）

这一节是"启动文档"的核心：按顺序做完，你会得到一个可演示的平台。
每一步都用平台自己的接口，不写库、不改状态字段。

```bash
# 0) 起服务
pnpm prisma:migrate && pnpm prisma:seed
pnpm --filter @mentor/api start:prod &            # 监听 3000

# 1) 探针
curl -s http://127.0.0.1:3000/api/v1/health/ready

# 2) 首位管理员：产品自带的引导路由（审计），然后用它签发控制台凭据并登录
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/v1/auth/wechat/login \
  -H 'content-type: application/json' -d '{"code":"first-admin"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.accessToken))")
curl -s -X POST http://127.0.0.1:3000/api/v1/admin/bootstrap -H "authorization: Bearer $TOKEN"
```

之后的三步（入驻与审核、发布与预约、支付与交付）在管理台与小程序里点击完成，或者交给自动化：

```bash
pnpm test:e2e-three    # 三端端到端：真实 API 进程 + 小程序模块 + 管理台客户端，7/7
```

该套件会：导师入驻并提交证件 → 控制台批准验证与商家 → 发布服务与时段 →
家长发现并下单 → 支付（mock 回调）→ 接单/开始 → 控制台同一幂等键退款两次只退一次 →
家长看到退款 → 审计日志留有审批记录。**它是这份走查的可执行版本**，也是唯一需要重置测试库的检查。

> 若你在开发者工具里手动走：管理台批准商家后，小程序导师端才能"发布"服务（未过审会被拒绝并给出原因）；
> 家长下单后进入支付页，本地点"模拟支付（仅本地）"，随后由服务端确认。

## 6. 验证与测试

```bash
pnpm lint           # eslint .
pnpm typecheck      # 全部工作区
pnpm test           # 单元测试（不连数据库）
```

以下**会重置 `DATABASE_TEST_URL` 指向的测试库**（`prisma migrate reset --force --skip-seed`），确认后再跑：

```bash
pnpm test:integration   # 46 文件 / 282 测试（含备份恢复演练）
pnpm test:e2e           # 8 条关键旅程（specs/14），整 AppModule 启动
pnpm test:e2e-three     # 三端联调（会构建 API 并起进程）
```

一次性跑完 CI 等价流程：`pnpm verify`（lint → build → typecheck → test → integration → e2e → e2e-three）。

## 7. 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| `pnpm build` 报 `safe-delete` | `nest build` 清空 `dist` 触发批量删除保护 | 见 §2 的绕开方式 |
| `EADDRINUSE` 3000 | API 已占用端口 | 换 `API_PORT`，或先停掉旧进程 |
| 管理台页面空白/数据为空 | 未设 `ADMIN_API_BASE_URL` 或会话过期 | 设变量后重启；重新登录 |
| `/health/ready` 503 | 数据库不可达 | 检查 `DATABASE_URL` 与 `pg_isready` |
| 小程序登录失败 | `AUTH_PROVIDER` 不是 mock 且缺 appid | 本地用 `AUTH_PROVIDER=mock` |
| 导师无法发布服务 | 未通过审核/验证 | 管理台批准后重试（服务端强制） |
| 支付一直"等待支付结果" | mock 网关没有回调 | 点"模拟支付（仅本地）"，或用 `test:e2e-three` 的流程 |

## 8. 运维脚本（本地可用）

```bash
DATABASE_URL='postgresql://…' PGPASSWORD='…' BACKUP_DIR=/tmp/mentor-backups ops/backup.sh
ops/restore.sh /tmp/mentor-backups/mentor-<timestamp>.dump 'postgresql://…/mentor_restore_check'
API_BASE_URL=http://127.0.0.1:3000 ops/smoke.sh
```

细节见 `ops/backups.md`、`ops/monitoring.md`、`ops/redis.md`、`ops/release.md`、`ops/runbook.md`。

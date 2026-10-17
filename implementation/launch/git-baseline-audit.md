# T025 — Git 基线审计报告

审计时间：2026-10-17
仓库：`/Users/zhangyang/Downloads/mentor-platform-spec-v1.0`
本轮性质：**只读审计**。未执行 `git commit` / `git push` / `git reset` / `git clean` / 任何历史改写，未修改业务代码，未删除任何文件。

---

## 1. 当前状态快照

| 项 | 结果 |
|---|---|
| 当前分支 | `main`（唯一本地分支；远程 `origin/main`） |
| HEAD | `1d19e70d697028ed85f01eeaa135e30daef009df` — "first commit"（张阳，2026-10-17 09:28 +0800） |
| 远端同步 | `git ls-remote origin main` = `1d19e70…`，与本地 HEAD **完全一致**；`git rev-list --left-right --count origin/main...HEAD` = `0  0` |
| 工作区 | `nothing to commit, working tree clean` |
| 远端地址 | `git@github.com:tornadohero/needyourhelp.git` |
| 提交总数 | 8 |
| 标签 | 0 个 |
| 已跟踪文件 | 539 |

**重要变化**：2026-10-12 审计时记录的"T002–T024 共 52 项未提交"问题**已经不存在**。2026-10-17 09:28 的一次提交将全部工作纳入版本控制并推送到 `origin/main`。因此本轮 T025 的核心目标（保护已有代码、不丢工作成果）**在当前状态下已经达成**，余下工作是基线的规范化与后续提交的分组纪律。

## 2. git status（第 1、4、5 项）

```
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```

| 类别 | 数量 |
|---|---|
| 未跟踪（非忽略）文件 | **0** |
| 已修改未暂存 | **0** |
| 已暂存未提交 | **0** |

磁盘与 Git 的一致性核对（防止"提交漏文件"）：

| 范围 | 磁盘 | Git 已跟踪 | 一致 |
|---|---|---|---|
| `apps/api/src/**/*.ts` | 273 | 273 | ✅ |
| `packages/**/*.ts`（排除 dist/node_modules） | 28 | 28 | ✅ |
| `ops/**` | 9 | 9 | ✅ |
| `implementation/**/*.md` | 7 | 7 | ✅ |

## 3. git log（第 2、3 项）

```
1d19e70 | 2026-10-17 09:28 | 张阳 | first commit          ← T002–T024 全部工作（438 files, +55125/-41）
6ea7627 | 2026-09-28 20:05 | 张阳 | chore(repo): bootstrap monorepo for T001
85aa232 | 2026-09-28 19:41 | 张阳 | chore(repo): expand root .gitignore for monorepo
f880ee5 | 2026-09-28 19:40 | 张阳 | chore(speckit): track Spec Kit and CodeBuddy command config
3533a05 | 2026-09-28 19:40 | 张阳 | docs(specs): resolve cross-spec inconsistencies
d0d07cb | 2026-09-28 19:40 | 张阳 | docs(agents): consolidate duplicated execution contract and fix specs path
7271cfd | 2026-09-28 17:08 | yang zhang | Update AGENTS.md
7bc7d71 | 2026-09-27 20:12 | 张阳 | Initial commit from local
```

`1d19e70` 的提交内容抽查（末尾摘要）：`prisma/schema.prisma`(+1006)、`prisma/seed-data.ts`(+193)、`prisma/seed.ts`(+24)、`specs/04-database-spec.md`(+7) —— 与 T002 及后续任务产物一致。

## 4. .gitignore（第 6 项）

生效规则（与审计相关的部分）：

| 规则 | 覆盖对象 | 实际效果 |
|---|---|---|
| `node_modules/`、`.pnpm-store/` | 依赖 | 已忽略（忽略清单中 `node_modules/.pnpm` 31809 条等） |
| `dist/`、`build/`、`coverage/`、`.turbo/`、`*.tsbuildinfo` | 构建产物 | 已忽略（`apps/api/dist` 1132 条、`packages/*/dist` 114 条、`apps/admin/.next` 120 条） |
| `.next/`、`out/`、`next-env.d.ts`、`.vercel` | Next.js 产物 | 已忽略 |
| `miniprogram_npm/` | 小程序依赖 | 已忽略 |
| `.env`、`.env.*` + `!.env.example` | 环境变量 | ✅ `.env` 已忽略，`.env.example` 故意跟踪（模板） |
| `logs/`、`*.log`、`npm-debug.log*`、`pnpm-debug.log*` | 运行日志 | 已忽略；仓库内实际不存在日志文件 |
| `.DS_Store`、`.idea/`、`.vscode/*` | 编辑器 | 已忽略 |

被忽略但属**自动生成、无需入库**的文件（无需处理）：`apps/admin/next-env.d.ts`（Next.js 生成）。

## 5. 敏感文件与泄露风险（第 7、8、9 项）

### 5.1 `.env` 是否被跟踪

```
git ls-files | grep '^\.env'   →  .env.example        （仅模板）
git check-ignore -v .env       →  .gitignore:25:.env  .env
```

**结论：`.env` 未入库且已被忽略；`.env.example` 为入库模板。** ✅

磁盘上的 env 类文件仅有 `./.env`（已忽略）与 `./.env.example`（已跟踪）。仓库内**不存在** `.pem` / `.p12` / `.key` / `*credentials*` / `*.log` 文件。

### 5.2 已跟踪文件密钥扫描（`git grep`，仅扫描入库内容）

| 检测项 | 结果 |
|---|---|
| `BEGIN ... PRIVATE KEY`（RSA/EC/OPENSSH/PGP） | **无命中** |
| 云商/平台令牌（`sk-…`、`ghp_…`、`AKIA…`） | **无命中** |
| `apiV3Key: '<literal>'` | 仅 `apps/api/src/modules/payments/infrastructure/wechat/wechat-pay-config.ts:130` |
| 长随机串赋值给 secret/password | **无命中** |
| `ACCESS_TOKEN_SECRET=` / `REFRESH_TOKEN_SECRET=` / `OPENID_HASH_PEPPER=` | 仅 `.env.example`，值为 `replace-me-access` / `replace-me-refresh` / `replace-me-openid-pepper` 占位符 |

关于 `wechat-pay-config.ts:130` 的 `'<redacted>'`：该行位于 `redactWeChatPayConfig()`（诊断安全视图，函数注释 "names only, never a value (`specs/13` §Logging)"），是**脱敏功能本身**，不是密钥。✅

### 5.3 数据库连接串

| 位置 | 内容 | 判断 |
|---|---|---|
| `.env.example:6,10` | `postgresql://postgres:postgres@localhost:5432/…` | 本地默认占位，非真实凭据 |
| `.github/workflows/ci.yml:36,37` | `postgresql://postgres:postgres@localhost:5432/mentor_platform_test` | CI 服务容器自有的固定测试凭据，与 `ACCESS_TOKEN_SECRET: ci-only-access-secret` 等一样是 CI 专用值 |
| `apps/api/test/all-exceptions.filter.spec.ts:65` | `'connection string: postgres://user:secret@host'` | 测试用假字符串（用于验证异常过滤器会脱敏） |
| `ops/backup.sh:38` | 注释中的 URL 格式说明 | 无凭据 |

**结论：未发现真实密钥、Token 或生产数据库密码入库。** ✅

## 6. T001–T024 代码是否真实存在（第 10 项）

以 `git ls-files` 校验（入库即视为已保存，避免"只在磁盘上"）：

| Task | 关键产物（已跟踪） | 文件数 |
|---|---|---|
| T001 | `pnpm-workspace.yaml`、5 个 `package.json`、`.github/workflows/ci.yml` | ✅ |
| T002 | `prisma/schema.prisma`、`prisma/migrations/*3`、`prisma/seed.ts`、`prisma/seed-data.ts` | ✅ |
| T003 | `apps/api/src/modules/auth/**` | 19 |
| T004 | `apps/api/src/modules/profile/**`、`identity/**` | 17 / 7 |
| T005 | `apps/api/src/modules/provider/**` | 18 |
| T006 | `apps/api/src/modules/verification/**` | 19 |
| T007 | `apps/api/src/modules/compliance/**` | 9 |
| T008 | `apps/api/src/modules/catalog/**` | 11 |
| T009 | `apps/api/src/modules/services/**` | 13 |
| T010 | `apps/api/src/modules/discovery/**` | 10 |
| T011 | `apps/api/src/modules/availability/**` | 11 |
| T012 | `apps/api/src/modules/messaging/**` | 17 |
| T013 | `apps/api/src/modules/orders/**` | 11 |
| T014/T015 | `apps/api/src/modules/payments/**`（含 `infrastructure/wechat/*`） | 19 |
| T016 | `apps/api/src/modules/refunds/**` | 12 |
| T017 | `apps/api/src/modules/reviews/**` | 12 |
| T018 | `apps/api/src/modules/moderation/**`、`audit/**` | 11 / 4 |
| T019 | `apps/api/src/modules/admin/**`、`platform/**` | 11 / 12 |
| T020 | `apps/api/src/modules/analytics/**` | 7 |
| T021 | `career_marketplace_enabled` 开关（platform 模块）+ `test/integration/career-http.spec.ts` | ✅ |
| T022 | `apps/api/src/common/security/**`、`idempotency/**` | ✅ |
| T023 | `apps/api/test/e2e/e2e-01…e2e-08.spec.ts` + `helpers/e2e.ts` | 9 |
| T024 | `ops/{README,backups,monitoring,runbook,incident-response,release-checklist}.md`、`ops/alert-rules.yml`、`ops/backup.sh`(100755)、`ops/restore.sh`(100755) | 9 |

`ops/backup.sh`、`ops/restore.sh` 的 Git 模式为 `100755`（可执行位已入库）✅。

## 7. 工作区安全性结论

| 检查 | 结论 |
|---|---|
| 未跟踪文件 | 0（无遗漏、无待提交） |
| 已修改文件 | 0 |
| `.env` 入库 | 否（已忽略） |
| 密钥/Token/生产密码入库 | 无 |
| node_modules / dist / .next / 日志入库 | 无（`1d19e70` 的 438 个文件中无此类路径） |
| 远端备份 | 有（`origin/main` = `1d19e70` = 本地 HEAD） |
| 源码完整性 | 磁盘与 Git 完全一致（273/273、28/28、9/9、7/7） |

**结论：工作区安全，无敏感文件，可以继续。**

## 8. 观察与残余风险（不阻塞，但建议处理）

| # | 观察 | 影响 | 约束下可采取的动作 |
|---|---|---|---|
| O1 | T002–T024 全部落在**一个**提交 `1d19e70 "first commit"` 中（438 文件），与 `AGENTS.md` §14"一个任务一个提交、Conventional Commits"不符 | 追溯困难：无法按任务回退 | 本轮**不可**拆分（拆分需 `reset`/`rebase`，被明令禁止）。只能保留该提交作为基线，后续提交遵守分组纪律 |
| O2 | 提交信息为 "first commit"，不含 `feat/fix/chore(scope):` 前缀 | 可读性 | 同上，不改写；建议用**附注标签**为基线补充语义 |
| O3 | `git config user.name` 为空（email 已配置） | 后续提交作者名为空，不合规 | 需用户自行设置（`git config user.name`），本轮不改动配置 |
| O4 | 无标签，无法快速定位"T024 完成"这个时点 | 回滚/对比缺锚点 | 建议打 `baseline-t024`（需确认后执行） |
| O5 | `implementation/launch/{environment,launch-audit,launch-progress}.md` 三个 **0 字节**文件已入库 | 启动文档仍为空 | 属 T025 后续工作内容，非 Git 问题 |
| O6 | 仓库无 `.gitattributes`、无提交钩子（如 gitleaks / prettier 检查） | 未来可能再次误提交敏感文件或未格式化代码 | 建议新增（需确认） |
| O7 | CI 中的 `ACCESS_TOKEN_SECRET: ci-only-access-secret` 等为仓库内固定值 | 仅用于 CI 测试，非生产；但若将来接入生产部署需改为密钥管理 | 记录为已知项 |

## 9. 建议的分组提交方案（**待你确认后才会执行**）

### 9.1 立即动作（零风险、不改写历史）

| 步骤 | 命令（未执行） | 说明 |
|---|---|---|
| A1 | `git tag -a baseline-t024 -m "Baseline: T001-T024 complete (API + ops), admin/miniprogram are placeholders"` | 为当前 `1d19e70` 打附注标签，作为可回滚锚点；不改动任何提交 |
| A2 | `git config user.name "<your name>"` | 补齐作者名（本轮不代填，避免写入我不了解的身份） |
| A3 | `git push origin baseline-t024` | 可选：把标签推到远端（普通 push，无 force） |

### 9.2 后续工作的提交分组（每个任务一组，组内小步提交）

针对"管理台与小程序尚未完成"这两块缺口，建议按任务拆分（沿用 `AGENTS.md` §14 的 `feat/fix/chore(scope):` 前缀）：

| 组 | 建议提交序列 | 内容 |
|---|---|---|
| **G1 — T025 收尾（文档/基线）** | `docs(launch): git baseline audit + commit plan`<br>`docs(launch): local environment runbook`<br>`chore(launch): fill launch progress tracker` | 本报告、`environment.md`（本地启动前置：PostgreSQL 16、`cp .env.example .env`、`prisma:generate/migrate/seed`、启动命令）、`launch-progress.md` |
| **G2 — 管理台（建议编号 T026）** | `feat(admin): api client with NEXT_PUBLIC_API_BASE_URL`<br>`feat(admin): login + session`<br>`feat(admin): provider review page`<br>`feat(admin): orders page`<br>`feat(admin): moderation page`<br>`feat(admin): platform configuration page`<br>`test(admin): …` | 对应 `specs/11` §Admin Web 与 `specs/12`；每页一个提交，附测试 |
| **G3 — 小程序（建议编号 T027）** | `chore(miniprogram): real appid 配置`<br>`feat(miniprogram): api client + wx.login`<br>`feat(miniprogram): parent pages`<br>`feat(miniprogram): provider pages`<br>`test(miniprogram): …` | 对应 `specs/11` §Parent/Provider pages；先替换 `touristappid` |
| **G4 — 工程修正（建议编号 T028）** | `feat(api): redis-backed rate limiter and idempotency store`<br>`chore(repo): add .gitattributes and pre-commit secret scan`<br>`fix(api): …` | 对应审计 B3（Redis 未接入）、O6（无钩子/属性文件） |

### 9.3 每次提交前的自检清单

1. `git status --short`：确认没有 `.env`、`node_modules/`、`dist/`、`.next/`、`*.log`；
2. `git diff --cached --name-only | grep -E "\.env$|node_modules|dist/|\.next/|\.log$"` 必须为空；
3. `git grep -InE "BEGIN .*PRIVATE KEY|sk-[A-Za-z0-9]{20,}|ghp_|AKIA[0-9A-Z]{16}" $(git diff --cached --name-only)` 无命中；
4. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` 通过（构建类改动另加 `pnpm test:integration` / `pnpm test:e2e`，注意二者会重置测试库）；
5. 提交信息使用 `feat/fix/chore/docs/test(scope): …`，scope 用 `api` / `admin` / `miniprogram` / `contracts` / `ops` / `repo`；
6. 推送只用 `git push origin <branch>` 或 `git push origin <tag>`，**禁止** `--force`。

### 9.4 明确不会执行的动作（本轮约束）

- ❌ `git commit` / `git push`（等确认）
- ❌ `git reset` / `git rebase` / `git commit --amend` / `git push --force`（不改写或覆盖已有提交）
- ❌ `git clean`（不删除任何文件）
- ❌ 提交 `.env`、`node_modules`、构建产物、运行日志
- ❌ 修改业务代码

---

## 10. 结论

**工作区安全，可以进入提交规划阶段。**

- 代码保护目标已达成：`1d19e70` 已包含 T001–T024 全部产物，并已推送至 `origin/main`（远端与本地同一 commit），源码磁盘/Git 完全一致。
- 无敏感文件入库：`.env` 被忽略，仅有占位符模板 `.env.example`；已跟踪文件中无私钥、无平台令牌、无生产凭据。
- 待你确认后，我再执行 9.1 的标签/配置动作与 9.2 的分组提交；在此之前不会有任何 `commit` 或 `push`。

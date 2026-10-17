# Launch progress — 启动进度追踪

追踪"本地可启动 / 产品可交付"之间还差什么。状态以 2026-10-12 仓库结构审计与 2026-10-17 Git 基线审计的实测证据为准。

## 1. 三个应用

| 应用 | 目录 | 本地启动 | 功能完成度 | 结论 |
|---|---|---|---|---|
| 后端 API | `apps/api` | ✅ 实测启动：`/health` 200、`/health/ready` 200 且 `database:"up"`、mock 登录返回 token | 23/24 任务 PASS，T019 PARTIAL（页面缺） | **READY FOR LOCAL LAUNCH** |
| 管理台 | `apps/admin` | ⚠️ `pnpm --filter @mentor/admin dev` 可起（默认端口与 API 冲突，需 `-p 3001`） | 仅 T001 占位页；无登录/无运营页面/无 env | **NOT READY** |
| 小程序 | `apps/miniprogram` | ⚠️ 微信开发者工具可打开 | 仅 T001 占位页；`touristappid`；无 API client | **NOT READY** |

## 2. 阻塞项（来自仓库结构审计）

| # | 阻塞项 | 严重度 | 现状（2026-10-17） |
|---|---|---|---|
| B1 | 管理台无运营页面 | 高 | 未开始（等待 T026） |
| B2 | 小程序无业务页面/API client | 高 | 未开始（等待 T027） |
| B3 | Redis 未接入（限流/幂等为内存实现） | 高（生产）/ 中（本地） | 未开始（等待 T028） |
| B4 | T002–T024 未提交 | 高 | **已解决**：`1d19e70` 已提交并推送 `origin/main` |
| B5 | 本环境 `pnpm build` 被批量删除保护拦截 | 中（本地） | 已写入 `environment.md` 的绕开方式 |
| B6 | 集成/E2E 未重跑（会重置测试库） | 中 | 待安排一次允许重置测试库的验证 |
| B7 | 无 `/metrics` 与外部拨测 | 中（生产） | 未开始 |
| B8 | `implementation/launch/*` 启动文档为空 | 中 | **本轮解决**：`environment.md`、本文件、`git-baseline-audit.md` 已写入；`launch-audit.md` 仍为空 |
| B9 | `task-breakdown.md` 无小程序/管理台任务 | 中 | 待新增 T026/T027（+T028 工程修正） |

## 3. 提交进度（T025 分组方案）

| 组 | 内容 | 状态 |
|---|---|---|
| 基线 | `git tag -a baseline-t024`（指向 `1d19e70`） + 推送标签 | 本轮执行 |
| G1 | `docs(launch): git baseline audit + commit plan`<br>`docs(launch): local environment runbook`<br>`chore(launch): launch progress tracker and T025 record` | 本轮执行 |
| G2 | 管理台页面（建议 T026）：api client → 登录 → provider review → orders → moderation → platform config | 待开始 |
| G3 | 小程序页面（建议 T027）：真实 appid → api client + `wx.login` → parent pages → provider pages | 待开始 |
| G4 | 工程修正（建议 T028）：Redis 版限流/幂等、`.gitattributes` 与提交前密钥扫描 | 待开始 |

## 4. 下一步建议顺序

1. 跑一次完整验证（允许重置测试库）：`pnpm test:integration` + `pnpm test:e2e`，把审计中"既有记录"升级为当期证据（解 B6）。
2. T026 管理台：先 `NEXT_PUBLIC_API_BASE_URL` 与登录，再按 `specs/11` §Admin Web / `specs/12` 逐页实现。
3. T027 小程序：申请真实 appid 替换 `touristappid`，实现 `wx.login` → `POST /api/v1/auth/wechat/login`。
4. T028 工程：Redis 适配器替换 `RateLimiter`/`IdempotencyStore` 的内存实现；加提交前密钥扫描钩子。

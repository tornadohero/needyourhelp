# WeChat Mini Program — 工程说明（T028）

家长与学生使用的微信小程序。后端是 `apps/api` 的模块化单体，本工程只做**展示与调用**。

## 目录

```text
apps/miniprogram
├── app.ts / app.json / app.wxss     应用外壳：启动时完成一次 wx.login 登录，5 个 Tab
├── pages/                页面（.ts / .wxml / .wxss / .json）
│   ├── home / discover（列表+筛选） / provider（详情） / messages / orders / me
├── src/
│   ├── config.ts          唯一需要为部署修改的文件（API 地址，无密钥）
│   ├── app-context.ts     client + session 的单例装配
│   ├── core/              纯逻辑，可在 Node 中测试
│   │   ├── env.ts         环境与原点的解析（非开发态必须是 HTTPS）
│   │   ├── routes.ts      端点路径副本 + :id 填充
│   │   ├── envelope.ts    {data} / {error:{code}} 解包
│   │   ├── errors.ts      错误码 → 文案与动作
│   │   ├── http.ts        ApiClient（注入 transport）
│   │   ├── session.ts     登录 / 刷新 / 单飞刷新 / 登出
│   │   ├── account.ts     账号视图模型（状态、角色，只读展示）
│   │   ├── filters.ts     发现筛选（规范化 → 查询串）
│   │   ├── paging.ts      分页合并（按 id 去重）
│   │   └── provider-view.ts 导师/服务/评价/时段视图模型
│   │   ├── consents.ts    同意记录（生效判定 = granted 且未撤回）
│   │   └── format.ts      金额（分）与时间格式化
│   ├── platform/wechat.ts 所有 wx.* 适配（request / login / storage）
│   └── services/          auth、profile（资料与同意）、discovery（发现与详情）用例
├── project.config.json    微信开发者工具配置（appid 需替换为真实 AppID）
└── vitest.config.ts       单元测试（Node 环境，只覆盖 src/core）
```

## 本地运行

1. 启动后端：`pnpm --filter @mentor/api start:prod`（默认 `http://localhost:3000`）。
2. 微信开发者工具导入本目录。
3. `src/config.ts` 保持 `env: 'develop'` 即可（自动指向 localhost）；
   体验版/正式版必须填写 `apiOrigin`，且必须是 `https://`，否则启动即报错。
4. 真机/预览需要在 `project.config.json` 填入真实 `appid`（当前为 `touristappid`），
   否则 `wx.login` 拿不到可用 code。

## 约束（不可绕过）

- **前端没有任何密钥**：不存商户号、API Key、Token 之外的敏感值；口令/证件/儿童数据一律不落 Storage。
- **不计算金额、不判定状态**：只展示服务端返回的 `amountMinor` 与订单状态；支付结果以
  `GET /orders/:id/payment-status` 为准。
- **不发明接口**：`ROUTES` 是契约路径的副本，`src/core/routes.test.ts` 会与
  `@mentor/api-contracts` 的 `ENDPOINTS` 逐一比对，后端改名会在测试阶段失败（漂移守卫）。
  之所以用副本而不是运行时依赖，是因为小程序不应引入 npm 运行时包（开发者工具需额外
  构建 npm，且 workspace 软链在工具中不稳定）。
- **未知字段会被拒绝**：服务端 `forbidNonWhitelisted`，客户端也不发送契约之外的字段。
- 每个异步页面都实现了 loading / empty / error / retry / 未登录状态（`specs/11` §UX requirements）。

## 测试

```bash
pnpm --filter @mentor/miniprogram test        # 38 个用例（Node 环境）
pnpm --filter @mentor/miniprogram typecheck   # tsc --noEmit
```

未覆盖：`wx.*` 适配层（无法在 Node 中运行），它由注入 transport 的方式保持可替换。

## 已实现 / 未实现

已实现：应用外壳与 5 个 Tab、登录与会话刷新、账号与资料（`GET/PUT /me/profile`）、
同意记录与撤回（`GET/POST/DELETE /me/consents`）、退出登录、**导师发现**（`GET /providers`
结构化筛选 + 分页加载更多 + 筛选面板与排序）、**导师详情**（已发布服务/评价/可预约时段）、
健康与就绪检查、错误码映射。

说明：后端没有关键词检索字段，发现页因此只提供契约里真实存在的结构化筛选
（城市/科目/年级/方式/价格/仅已验证/排序），不做客户端假搜索。

未实现：下单与支付、订单列表/详情、聊天、儿童档案、举报、导师入驻与验证等页面，
见 `implementation/frontend/frontend-task-breakdown.md`（FE-30 起）。

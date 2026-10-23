# API Contract Map — 后端真实契约映射（T027）

本文件是**前端开发的唯一接口依据**。所有条目均从 `apps/api/src/**/*.controller.ts` 的装饰器、
DTO 与返回类型实际提取，未虚构任何接口。基线与版本：分支 `main`，`baseline-t024`（`1d19e70`）。

- 提取方式：`@Controller('prefix')` + `@Get/@Post/@Patch/@Put/@Delete` 全量扫描（95 条路由），
  请求/响应类型取自方法签名，错误码取自 `packages/api-contracts/src/error-codes.ts`。
- **未修改任何后端代码、未修改数据库、未创建前端页面。**

## 0. 通用约定

| 项 | 约定 |
|---|---|
| Base path | `/api/v1`（`API_BASE`，见 `packages/api-contracts/src/endpoints.ts`） |
| 成功响应 | `{ "data": <payload>, "requestId": "<uuid>" }`（`ResponseEnvelopeInterceptor`） |
| 错误响应 | `{ "error": { "code": "<CODE>", "message": "<文本>" }, "requestId": "<uuid>" }`（`AllExceptionsFilter`） |
| 请求 ID | 请求头 `x-request-id` 可传入；响应头回显，用于串联日志 |
| 鉴权 | `Authorization: Bearer <accessToken>`；`POST /auth/refresh` 轮换 refresh token |
| 金额 | **整数最小单位**（分），字段名 `amountMinor` / `priceMinor` / `refundableMinor`；前端禁止自行计算或传金额 |
| 时间 | ISO-8601 UTC（`2026-10-17T03:51:24.231Z`），展示层自行转时区 |
| 分页 | `page`（从 1 起）、`pageSize`（上限 50），响应 `{ items, total, page, pageSize }` |
| 校验 | 全局 `ValidationPipe{ whitelist, forbidNonWhitelisted }`：**未知字段直接 400**，前端不可附带额外字段 |
| 幂等 | 退款管理端接口支持 `Idempotency-Key` 请求头（同键重放返回同一结果；同键异载荷 409） |
| 限流 | 默认 300 次/分钟/地址；`auth.login` 10/分钟；`payments.session` 20/小时；`reviews.create` 10/天；超限 `RATE_LIMITED`(429) |

### 错误码（前端必须按 `code` 分支，不要按 `message`）

| code | HTTP | 前端处理 |
|---|---|---|
| `AUTH_REQUIRED` | 401 | 清会话 → 重新登录 |
| `FORBIDDEN` | 403 | 权限不足（角色/资源属主） |
| `NOT_FOUND` | 404 | 不存在或无访问权（**不区分**，防止资源探测） |
| `VALIDATION_ERROR` | 400 | 表单错误（含未知字段被拒） |
| `PROVIDER_NOT_APPROVED` | 409 | 商家未通过审核 |
| `SERVICE_NOT_PUBLISHED` | 409 | 服务未发布 |
| `ORDER_NOT_PAYABLE` | 409 | 订单不可支付 |
| `ORDER_INVALID_STATE` | 409 | 状态机拒绝（刷新订单详情） |
| `PAYMENT_FAILED` | 402 | 支付失败 |
| `PAYMENT_CALLBACK_INVALID` | 400 | 回调异常（前端一般遇不到） |
| `REFUND_NOT_ALLOWED` | 409 | 超额/不可退 |
| `REVIEW_NOT_ELIGIBLE` | 409 | 未完成订单或已评价 |
| `BLOCKED_USER` | 403 | 已被屏蔽 |
| `CONSENT_REQUIRED` | 403 | 需先取得监护人同意 |
| `CHILD_ACCESS_DENIED` | 403 | 儿童数据越权 |
| `RATE_LIMITED` | 429 | 退避重试 |
| `IDEMPOTENCY_CONFLICT` | 409 | 同键不同载荷 |
| `INTERNAL_ERROR` | 500 | 兜底，不泄漏内部信息 |

---

## 1. Authentication

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/auth/wechat/login` | 公开 | `WeChatLoginDto{code}` | `LoginResponse`（201，含 access/refresh token、user） | `VALIDATION_ERROR`、`AUTH_REQUIRED`、`RATE_LIMITED` | 小程序启动/登录；管理台（仅 mock 环境） | 已实现 | `auth-http.spec.ts` |
| POST | `/auth/refresh` | 可选 JWT | `RefreshTokenDto{refreshToken}` | `AuthTokensResponse` | `AUTH_REQUIRED` | 全局 token 续期 | 已实现 | `auth-session.spec.ts` |
| POST | `/auth/logout` | 可选 JWT | `LogoutDto{refreshToken}` | `LogoutResponse` | `AUTH_REQUIRED` | 设置/退出登录 | 已实现 | `auth-http.spec.ts` |
| GET | `/me` | JWT | — | `MeResponse`（用户 + 角色） | `AUTH_REQUIRED` | 全局会话引导 | 已实现 | `auth-http.spec.ts` |

## 2. User Profile（含儿童与同意 — 涉未成年人）

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| GET | `/me/profile` | JWT | — | `ProfileResponse` | `AUTH_REQUIRED` | 小程序「Me / 隐私与设置」 | 已实现 | `profile-http.spec.ts` |
| PUT | `/me/profile` | JWT | `UpdateProfileDto` | `ProfileResponse` | `VALIDATION_ERROR` | 资料编辑 | 已实现 | `profile-http.spec.ts` |
| GET | `/me/children` | JWT（监护人本人） | — | `ChildListResponse{children}` | `AUTH_REQUIRED` | 儿童档案列表 | 已实现 | `profile-http.spec.ts` |
| POST | `/me/children` | JWT | `CreateChildDto{nickname,birthYear?,gradeCode?,schoolName?,learningGoals?,consentPolicyVersion}` | `ChildProfileResponse`（201） | `VALIDATION_ERROR`、`CONSENT_REQUIRED` | 新建儿童档案（含监护人同意） | 已实现 | `profile-http.spec.ts` |
| GET | `/me/children/:id` | JWT（**属主**，他人 404） | — | `ChildProfileResponse` | `NOT_FOUND`、`CHILD_ACCESS_DENIED` | 儿童档案详情 | 已实现 | `profile-http.spec.ts` + E2E-06 |
| PATCH | `/me/children/:id` | JWT（属主） | `UpdateChildDto` | `ChildProfileResponse` | `VALIDATION_ERROR`、`NOT_FOUND` | 编辑儿童档案 | 已实现 | `profile-http.spec.ts` |
| DELETE | `/me/children/:id` | JWT（属主） | — | `ChildDeletionResponse`（软删除） | `NOT_FOUND` | 删除儿童档案 | 已实现 | `profile-http.spec.ts` |
| GET | `/me/consents` | JWT | — | `ConsentListResponse` | `AUTH_REQUIRED` | 隐私与同意管理 | 已实现 | `profile-http.spec.ts` |
| POST | `/me/consents` | JWT | `GrantConsentDto` | `ConsentResponse` | `VALIDATION_ERROR` | 授予同意 | 已实现 | `profile-http.spec.ts` |
| DELETE | `/me/consents/:consentType` | JWT | — | `ConsentResponse` | `VALIDATION_ERROR` | 撤回同意 | 已实现 | `profile-http.spec.ts` |
| POST | `/users/:id/block` | JWT | — | `BlockResponse` | `NOT_FOUND`、`BLOCKED_USER` | 屏蔽用户 | 已实现 | `messaging-http.spec.ts` |
| DELETE | `/users/:id/block` | JWT | — | `UnblockResponse` | `NOT_FOUND` | 解除屏蔽 | 已实现 | `messaging-http.spec.ts` |

## 3. Provider Onboarding

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/providers/applications` | JWT | `CreateProviderApplicationDto{publicName,cityCode,capabilityTypes[]}` | `ProviderProfileResponse`（201） | `VALIDATION_ERROR`、`RATE_LIMITED` | 小程序「导师入驻」 | 已实现 | `provider-http.spec.ts` + E2E-02 |
| GET | `/providers/me?providerType=TUTORING\|CAREER` | JWT | query | `ProviderProfileResponse` | `NOT_FOUND` | 入驻状态/资料编辑 | 已实现 | `provider-http.spec.ts` |
| PATCH | `/providers/me?providerType=` | JWT | `UpdateProviderProfileDto` | `ProviderProfileResponse` | `VALIDATION_ERROR` | 资料编辑 | 已实现 | `provider-http.spec.ts` |
| PUT | `/providers/me?providerType=` | JWT | `ReplaceProviderProfileDto` | `ProviderProfileResponse` | `VALIDATION_ERROR` | 资料编辑（小程序：整表替换，因为没有 PATCH） | 已实现 | `provider-http.spec.ts` |
| POST | `/providers/me/submit?providerType=` | JWT | — | `ProviderProfileResponse`（200） | `ORDER_INVALID_STATE` 类状态错误 | 提交审核 | 已实现 | `provider-http.spec.ts` |

## 4. Verification（含私密证件）

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/verification/cases` | JWT | `CreateVerificationCaseDto{verificationType}` | `VerificationCaseResponse`（201） | `VALIDATION_ERROR` | 身份/学历验证入口 | 已实现 | `verification-http.spec.ts` |
| GET | `/verification/me?providerType=` | JWT | query | `MyVerificationResponse` | `NOT_FOUND` | 验证状态页 | 已实现 | `verification-http.spec.ts` |
| POST | `/verification/cases/:id/documents/upload-url` | JWT | `RequestUploadUrlDto{documentType,contentType,byteSize,fileHash?}` | `VerificationUploadUrlResponse`（201，签名 URL，15 分钟） | `VALIDATION_ERROR`、`NOT_FOUND` | 上传证件 | 已实现（上传目标见 §14；**`fileHash` 可选**，小程序无法计算 SHA-256，由服务端按收到的字节记录） | `verification-http.spec.ts`、`files.controller.spec.ts` |
| PUT | `/files/verification/:caseId/:documentId?expires=&signature=` | **签名 URL**（无会话） | 二进制正文（`image/jpeg|png|webp`、`application/pdf`；≤ `VERIFICATION_DOCUMENT_MAX_BYTES`） | `{key,byteSize,contentType}`（200） | `FORBIDDEN`（签名无效/过期/用途不符）、`VALIDATION_ERROR`(413/415)、`NOT_FOUND` | 上传证件（T027b G3） | 已实现 | `verification-files-http.spec.ts`、`files.controller.spec.ts` |
| GET | `/files/verification/:caseId/:documentId?expires=&signature=` | **签名 URL** | — | 二进制（`cache-control: no-store`） | 同上 | 查看证件（T027b G3） | 已实现 | 同上 |
| POST | `/verification/cases/:id/submit` | JWT | — | `VerificationCaseResponse`（200） | `NOT_FOUND`、`VALIDATION_ERROR` | 提交验证 | 已实现 | `verification-http.spec.ts` |
| GET | `/admin/verifications` | ADMIN/OPS | `VerificationQueueQueryDto` | `AdminVerificationQueueResponse` | `FORBIDDEN` | 管理台「商家审核」 | 已实现 | `verification-http.spec.ts` |
| POST | `/admin/verifications/:id/approve` | ADMIN/OPS | `VerificationDecisionDto{reasonCode,notes?}` | `AdminVerificationCaseResponse`（200） | `VALIDATION_ERROR`、`FORBIDDEN` | 审核通过 | 已实现 | `verification-http.spec.ts` |
| POST | `/admin/verifications/:id/reject` | ADMIN/OPS | `VerificationDecisionDto` | `AdminVerificationCaseResponse`（200） | 同上 | 审核驳回 | 已实现 | `verification-http.spec.ts` |
| POST | `/admin/verifications/:id/documents/:documentId/access-url` | ADMIN/OPS | `DocumentAccessDto{reasonCode:'REVIEW',notes?}` | `VerificationDocumentAccessResponse`（200，5 分钟） | `FORBIDDEN` | 审核查看证件 | 已实现 | `verification-http.spec.ts` |

## 5. Provider Discovery（公开）

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| GET | `/providers` | 公开（可选 JWT） | `ProviderSearchQueryDto{domain,providerType,city,subject,grade,deliveryMode,minPrice,maxPrice,verifiedOnly,page,pageSize,sort}` | `ProviderSearchResponse{items,total,page,pageSize}` | `VALIDATION_ERROR`、`RATE_LIMITED` | 小程序「发现/搜索/筛选/列表」 | 已实现 | `discovery-http.spec.ts` |
| GET | `/providers/:id` | 公开（可选 JWT） | — | `ProviderDetailResponse`（公开档案 + 已发布服务） | `NOT_FOUND` | 导师详情 | 已实现 | `discovery-http.spec.ts` |
| GET | `/providers/:id/services` | 公开 | — | `PublicProviderServiceListResponse` | `NOT_FOUND` | 导师详情服务列表 | 已实现 | `discovery-http.spec.ts` |
| GET | `/providers/:id/reviews?page&pageSize` | 公开 | `ProviderReviewsQueryDto` | `ProviderReviewListResponse` | `NOT_FOUND` | 导师详情评价 | 已实现 | `reviews-http.spec.ts` |
| GET | `/providers/:id/availability` | 公开（可选 JWT） | — | `AvailabilityListResponse` | `NOT_FOUND` | 预约选时段 | 已实现 | `availability-http.spec.ts` |

## 6. Service Catalog（导师自有服务）

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/providers/me/services?providerType=` | JWT（导师） | `CreateServiceDto{title,durationMinutes,priceMinor,subjectCodes[]}` | `ServiceResponse`（201） | `VALIDATION_ERROR`、`PROVIDER_NOT_APPROVED` | 服务编辑 | 已实现 | `services-http.spec.ts` |
| GET | `/providers/me/services?providerType=` | JWT（导师） | query | `ProviderServiceListResponse` | `NOT_FOUND` | 服务列表 | 已实现 | `services-http.spec.ts` |
| PATCH | `/providers/me/services/:id` | JWT（导师） | `UpdateServiceDto` | `ServiceResponse` | `VALIDATION_ERROR`、`NOT_FOUND` | 服务编辑 | 已实现 | `services-http.spec.ts` |
| PUT | `/providers/me/services/:id` | JWT（导师） | `ReplaceServiceDto` | `ServiceResponse` | `VALIDATION_ERROR`、`NOT_FOUND` | 服务编辑（小程序：整表替换） | 已实现 | `services-http.spec.ts` |
| POST | `/providers/me/services/:id/publish` | JWT（导师） | query | `ServiceResponse`（200） | `PROVIDER_NOT_APPROVED`、`NOT_FOUND` | 发布服务 | 已实现 | `services-http.spec.ts` |
| POST | `/providers/me/services/:id/unpublish` | JWT（导师） | query | `ServiceResponse`（200） | `NOT_FOUND` | 下架服务 | 已实现 | `services-http.spec.ts` |

## 7. Availability

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/providers/me/availability?providerType=` | JWT（导师） | `CreateAvailabilitySlotDto{startAt,endAt,recurrenceRule?}` | `AvailabilitySlotResponse`（201） | `VALIDATION_ERROR`、`PROVIDER_NOT_APPROVED` | 导师可用时间 | 已实现 | `availability-http.spec.ts` |
| DELETE | `/providers/me/availability/:id` | JWT（导师） | query | `AvailabilityDeletionResponse` | `NOT_FOUND` | 删除时段 | 已实现 | `availability-http.spec.ts` |
| GET | `/providers/:id/availability` | 公开 | — | `AvailabilityListResponse` | `NOT_FOUND` | 预约选时段 | 已实现 | `availability-http.spec.ts` |

## 8. Order（状态机驱动，禁止直接改状态）

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/orders` | JWT（买方） | `CreateOrderDto{serviceId,childId?,scheduledStart,scheduledEnd,note?}` | `OrderResponse`（201，**金额由服务端计算**） | `VALIDATION_ERROR`、`PROVIDER_NOT_APPROVED`、`SERVICE_NOT_PUBLISHED`、`NOT_FOUND` | 创建预约 | 已实现 | `orders-http.spec.ts` + E2E-01/03 |
| GET | `/orders` | JWT | `OrderListQueryDto` | `OrderListResponse` | `AUTH_REQUIRED` | 订单列表（Tab 4） | 已实现 | `orders-http.spec.ts` |
| GET | `/orders/:id` | JWT（参与方） | — | `OrderResponse` | `NOT_FOUND` | 订单详情 | 已实现 | `orders-http.spec.ts` |
| POST | `/orders/:id/cancel` | JWT（买方） | — | `OrderResponse`（200） | `ORDER_INVALID_STATE` | 取消订单 | 已实现 | `orders-http.spec.ts` |
| POST | `/orders/:id/confirm` | JWT（**导师**） | — | `OrderResponse`（200） | `FORBIDDEN`、`ORDER_INVALID_STATE` | 导师接单 | 已实现 | `orders-http.spec.ts` |
| POST | `/orders/:id/start` | JWT（导师） | — | `OrderResponse`（200） | 同上 | 开始服务 | 已实现 | `orders-http.spec.ts` |
| POST | `/orders/:id/complete` | JWT（导师） | — | `OrderResponse`（200） | 同上 | 完成服务 | 已实现 | `orders-http.spec.ts` |

## 9. Payment（真实支付）

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/orders/:id/payment-session` | JWT（买方） | — | `PaymentSessionResponse`（201，含 `providerTransactionId`、金额、mock 支付参数） | `ORDER_NOT_PAYABLE`、`NOT_FOUND`、`RATE_LIMITED` | 支付页 | 已实现（mock/微信适配） | `payments-http.spec.ts` + E2E-01/04/05 |
| GET | `/orders/:id/payment-status` | JWT | — | `PaymentStatusResponse` | `NOT_FOUND` | 支付结果轮询（**服务端确认，不以客户端回调为准**） | 已实现 | `payments-http.spec.ts` |
| POST | `/payments/wechat/notify` | **微信网关**（非前端） | 回调报文 | `PaymentNotificationResponse` | `PAYMENT_CALLBACK_INVALID` | — | 已实现（前端不可调用） | `payments-http.spec.ts` |

## 10. Refund

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/orders/:id/refund-request` | JWT（买方） | `RefundRequestDto{reason?}` | `RefundRequestResponse{orderId,orderStatus,refundableMinor}`（200，**不动钱**） | `ORDER_INVALID_STATE`、`NOT_FOUND` | 申请退款 | 已实现 | `refunds-http.spec.ts` + E2E-08 |
| GET | `/orders/:id/refunds` | JWT（参与方） | — | `RefundListResponse` | `NOT_FOUND` | 退款进度 | 已实现 | `refunds-http.spec.ts` |
| POST | `/admin/orders/:id/refund` | ADMIN/OPS | `AdminRefundDto{amountMinor?,reason?}` + `Idempotency-Key` | `RefundResponse`（200） | `REFUND_NOT_ALLOWED`、`IDEMPOTENCY_CONFLICT` | 管理台「订单-退款」 | 已实现 | `refunds-http.spec.ts` + E2E-08 |

## 11. Review

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/orders/:id/reviews` | JWT（参与方，**仅 COMPLETED 订单**） | `CreateReviewDto{rating(1-5),content?}` | `ReviewResponse`（201） | `REVIEW_NOT_ELIGIBLE`、`VALIDATION_ERROR` | 评价页 | 已实现 | `reviews-http.spec.ts` + E2E-01 |
| GET | `/orders/:id/reviews` | JWT（参与方） | — | `ReviewListResponse` | `NOT_FOUND` | 订单评价 | 已实现 | `reviews-http.spec.ts` |
| GET | `/providers/:id/reviews` | 公开 | `ProviderReviewsQueryDto` | `ProviderReviewListResponse` | `NOT_FOUND` | 导师详情评价 | 已实现 | `reviews-http.spec.ts` |

## 12. Report / Moderation

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/reports` | JWT | `CreateReportDto{targetType,targetId,reasonCode,description?}` | `CreateReportResponse{reportId,caseId,caseCreated}`（201） | `VALIDATION_ERROR`、`NOT_FOUND`、`RATE_LIMITED` | 举报/投诉页 | 已实现 | `moderation-http.spec.ts` |
| GET | `/me/reports` | JWT | `ReportListQueryDto` | `ReportListResponse` | `AUTH_REQUIRED` | 我的举报 | 已实现 | `moderation-http.spec.ts` |
| POST | `/reports/:id/appeal` | JWT（举报人或被举报方） | `AppealDto{reason}` | `ModerationCaseResponse`（200） | `NOT_FOUND`、`FORBIDDEN` | 申诉 | 已实现 | `moderation-http.spec.ts` |
| GET | `/admin/reports` | ADMIN/OPS | `ReportListQueryDto` | `AdminReportQueueResponse` | `FORBIDDEN` | 管理台「审核-举报队列」 | 已实现 | `moderation-http.spec.ts` |
| POST | `/admin/reports/:id/resolve` | ADMIN/OPS | `ResolveReportDto{resolution,outcome?,action?,severity?}` | `ModerationDecisionResponse`（200） | `VALIDATION_ERROR`、`FORBIDDEN` | 处置 | 已实现 | `moderation-http.spec.ts` |
| POST | `/admin/moderation/:id/transition` | ADMIN/OPS | `TransitionCaseDto{status,note?}` | `ModerationCaseResponse`（200） | `VALIDATION_ERROR` | 调查流转 | 已实现 | `moderation-http.spec.ts` |
| POST | `/admin/moderation/:id/finalize` | ADMIN/OPS | `FinalizeCaseDto{decision,decisionReason}` | `ModerationCaseResponse`（200，**须由另一名管理员执行**） | `FORBIDDEN` | 终审 | 已实现 | `moderation-http.spec.ts` |

## 13. Admin（运营）

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/admin/bootstrap` | JWT（**首位管理员**） | — | `AdminRoleChangeResponse`（200） | `FORBIDDEN` | 管理台首次引导 | 已实现 | `admin-operations-http.spec.ts` |
| GET | `/admin/dashboard` | ADMIN/OPS | — | `AdminDashboardCounts` | `FORBIDDEN` | Dashboard | 已实现 | `admin-operations-http.spec.ts` |
| GET | `/admin/users` | ADMIN/OPS | `AdminUserListQueryDto` | `AdminUserListResponse` | `FORBIDDEN` | 用户管理 | 已实现 | `admin-operations-http.spec.ts` |
| POST | `/admin/users/:id/roles` | ADMIN/OPS | `GrantRoleDto` | `AdminRoleChangeResponse` | `VALIDATION_ERROR`、`FORBIDDEN` | 授权 | 已实现 | `admin-operations-http.spec.ts` |
| DELETE | `/admin/users/:id/roles/:role` | ADMIN/OPS | — | `AdminRoleChangeResponse` | `FORBIDDEN` | 撤权 | 已实现 | `admin-operations-http.spec.ts` |
| GET | `/admin/providers` | ADMIN/OPS | `AdminProviderListQueryDto` | `AdminProviderListResponse` | `FORBIDDEN` | 商家列表 | 已实现 | `admin-operations-http.spec.ts` |
| POST | `/admin/providers/:id/approve` | ADMIN/OPS | `ApproveProviderDto{reason}` | `ProviderProfileResponse`（200） | `VALIDATION_ERROR`、`FORBIDDEN` | 商家通过 | 已实现 | `admin-operations-http.spec.ts` |
| POST | `/admin/providers/:id/reject` | ADMIN/OPS | `RejectProviderDto` | `ProviderProfileResponse`（200） | 同上 | 驳回 | 已实现 | `admin-operations-http.spec.ts` |
| POST | `/admin/providers/:id/suspend` | ADMIN/OPS | `SuspendProviderDto{reason}` | `ProviderProfileResponse`（200） | 同上 | 暂停 | 已实现 | `admin-operations-http.spec.ts` |
| POST | `/admin/providers/:id/restore` | ADMIN/OPS | `ApproveProviderDto` | `ProviderProfileResponse`（200） | 同上 | 恢复 | 已实现 | `admin-operations-http.spec.ts` |
| GET | `/admin/orders` | ADMIN/OPS | `AdminOrderListQueryDto` | `AdminOrderListResponse` | `FORBIDDEN` | 订单查询 | 已实现 | `admin-operations-http.spec.ts` |
| GET | `/admin/audit-logs` | ADMIN/OPS | `AdminAuditLogQueryDto` | `AdminAuditLogListResponse` | `FORBIDDEN` | 审计日志 | 已实现 | `admin-operations-http.spec.ts` |
| GET | `/admin/compliance` | ADMIN/OPS | `ComplianceQueueQueryDto` | `AdminComplianceQueueResponse` | `FORBIDDEN` | 教师合规队列 | 已实现 | `compliance-http.spec.ts` |
| POST | `/admin/compliance/:capabilityId/start-review` | ADMIN/OPS | `ComplianceDecisionDto{reasonCode,notes?}` | `AdminComplianceItemResponse`（200） | `VALIDATION_ERROR` | 开始复核 | 已实现 | `compliance-http.spec.ts` |
| POST | `/admin/compliance/:capabilityId/approve` | ADMIN/OPS | `ComplianceDecisionDto` | `AdminComplianceItemResponse`（200） | 同上 | 合规通过 | 已实现 | `compliance-http.spec.ts` + E2E-03 |
| POST | `/admin/compliance/:capabilityId/restrict` | ADMIN/OPS | `RestrictComplianceDto{reasonCode,restriction{allowedSubjectCodes?,cityCodes?}}` | `AdminComplianceItemResponse`（200） | 同上 | 限制范围 | 已实现 | `compliance-http.spec.ts` |
| POST | `/admin/compliance/:capabilityId/reject` | ADMIN/OPS | `ComplianceDecisionDto` | `AdminComplianceItemResponse`（200） | 同上 | 驳回 | 已实现 | `compliance-http.spec.ts` |
| POST | `/admin/compliance/:capabilityId/suspend` | ADMIN/OPS | `ComplianceDecisionDto` | `AdminComplianceItemResponse`（200） | 同上 | 暂停资格 | 已实现 | `compliance-http.spec.ts` |
| GET | `/admin/taxonomy` | ADMIN/OPS | `TaxonomyListQueryDto` | `AdminTaxonomyListResponse` | `FORBIDDEN` | 平台配置-类目 | 已实现 | `taxonomy-admin-http.spec.ts` |
| POST | `/admin/taxonomy` | ADMIN/OPS | `CreateTaxonomyTermDto` | `TaxonomyTermResponse`（201） | `VALIDATION_ERROR` | 新增类目 | 已实现 | `taxonomy-admin-http.spec.ts` |
| PATCH | `/admin/taxonomy/:id` | ADMIN/OPS | `UpdateTaxonomyTermDto` | `TaxonomyTermResponse` | `VALIDATION_ERROR` | 编辑类目 | 已实现 | `taxonomy-admin-http.spec.ts` |
| POST | `/admin/taxonomy/:id/archive` | ADMIN/OPS | — | `TaxonomyTermResponse`（200，归档不删除） | `NOT_FOUND` | 归档类目 | 已实现 | `taxonomy-admin-http.spec.ts` |
| GET | `/admin/feature-flags` | ADMIN/OPS | — | `AdminFeatureFlagListResponse` | `FORBIDDEN` | 平台配置-特性开关 | 已实现 | `admin-platform-http.spec.ts` |
| PATCH | `/admin/feature-flags/:key` | ADMIN/OPS | `SetFeatureFlagDto{enabled,configJson?}` | `{key,enabled}` | `VALIDATION_ERROR` | 切换开关 | 已实现 | `admin-platform-http.spec.ts` |
| GET | `/admin/platform-rules?ruleType=` | ADMIN/OPS | query | `PlatformRuleListResponse` | `FORBIDDEN` | 平台配置-规则（费率/取消政策） | 已实现 | `admin-platform-http.spec.ts` |
| POST | `/admin/platform-rules` | ADMIN/OPS | `CreatePlatformRuleDto` | `PlatformRuleResponse`（201） | `VALIDATION_ERROR` | 新建规则 | 已实现 | `admin-platform-http.spec.ts` |
| POST | `/admin/platform-rules/:id/publish` | ADMIN/OPS | — | `PlatformRuleResponse`（200） | `NOT_FOUND` | 发布规则 | 已实现 | `admin-platform-http.spec.ts` |

## 14. Career Mentoring（复用，不新增接口）

职业赛道**没有专属接口**，全部通过查询参数复用既有接口，并由 `career_marketplace_enabled` 开关门控（关时返回 404/拒绝）：

| 用途 | 复用接口 |
|---|---|
| 职业导师发现 | `GET /providers?domain=CAREER` |
| 职业导师详情/服务/评价/时段 | `GET /providers/:id`、`/providers/:id/services`、`/providers/:id/reviews`、`/providers/:id/availability` |
| 职业导师入驻 | `POST /providers/applications`（capability `CAREER_MENTOR`）、`GET|PATCH /providers/me?providerType=CAREER`、`POST /providers/me/submit?providerType=CAREER` |
| 职业服务/时段 | `POST /providers/me/services?providerType=CAREER`、`POST /providers/me/availability?providerType=CAREER` |
| 职业订单 | `POST /orders` + 订单命令（带 `providerType=CAREER`） |
| 开关 | `GET /admin/feature-flags`、`PATCH /admin/feature-flags/career_marketplace_enabled` |

测试：`career-http.spec.ts`（关闭时路由拒绝，开启时复用链路不变）。

## 15. IM / 会话（V1 为适配器抽象）

| Method | Endpoint | Auth | Request | Response | Errors | 前端页面 | 状态 | 测试 |
|---|---|---|---|---|---|---|---|---|
| POST | `/conversations` | JWT | `CreateConversationDto` | `ConversationResponse`（201） | `VALIDATION_ERROR`、`BLOCKED_USER` | 建立会话 | 已实现 | `messaging-http.spec.ts` |
| GET | `/conversations` | JWT | `ConversationListQueryDto` | `ConversationListResponse` | `AUTH_REQUIRED` | 消息列表（Tab 3） | 已实现 | `messaging-http.spec.ts` |
| GET | `/conversations/:id` | JWT（成员） | — | `ConversationResponse{members,messages:MessageReferenceResponse[]}` | `NOT_FOUND` | 聊天页 | 已实现（发消息见 §15） | `messaging-http.spec.ts` |
| POST | `/conversations/:id/report` | JWT（成员） | `ReportConversationDto` | `ConversationReportResponse` | `NOT_FOUND`、`VALIDATION_ERROR` | 举报会话 | 已实现 | `messaging-http.spec.ts` |
| POST | `/conversations/:id/messages` | JWT（成员，会话 OPEN，无屏蔽） | `SendMessageDto{body,messageType?}` | `MessageResponse`（201） | `NOT_FOUND`、`BLOCKED_USER`、`VALIDATION_ERROR`、`RATE_LIMITED` | **聊天发送**（T027b G4） | 已实现 | `messaging-messages-http.spec.ts`、`messages.spec.ts` |
| GET | `/conversations/:id/messages?limit=` | JWT（成员） | `MessageListQueryDto` | `MessageListResponse` | `NOT_FOUND` | 聊天记录 | 已实现 | 同上 |

## 16. Ops（非业务）

| Method | Endpoint | Auth | Response | 前端用途 |
|---|---|---|---|---|
| GET | `/health` | 公开 | `HealthResponse{status,service,env,time}` | 连通性自检 |
| GET | `/health/ready` | 公开 | `ReadinessResponse{database:'up'\|'down',databaseLatencyMs}` | 就绪自检（库不可达 503） |

---

## 17. 统计与缺口

### 17.1 数量

| 类别 | 数量 |
|---|---|
| 后端路由总数（扫描所得，T027b 后） | **102** |
| 其中 ADMIN/OPS 角色路由 | 38 |
| 其中首位管理员引导（仅 JWT） | 1 |
| 其中微信支付网关回调 | 1（前端不可调用） |
| 其中运维探针 | 2 |
| **小程序可直接复用** | **59** |
| **管理台可复用**（38 角色路由 + 1 引导 + 7 鉴权/控制台 + 2 探针） | **48** |

### 17.2 缺失或不完整的接口（前端需要、后端当前没有）

| # | 缺口 | 影响页面 | 说明 |
|---|---|---|---|
| ~~G1~~ | ~~管理台非微信登录~~ | 管理台全部 | **已交付（T027b）**：`POST /auth/console/login` + `POST/DELETE /admin/console-credentials`；scrypt 加盐哈希、失败计数与锁定、限流、审计；只对已持有 ADMIN/OPS 的账号生效，登录不授予角色 |
| G2 | 公开单服务详情 `GET /services/:id` | 小程序「服务详情」 | 现只能用 `GET /providers/:id/services` 列表代替 |
| ~~G3~~ | ~~对象存储上传/下载路由~~ | 身份/学历验证上传 | **已交付（T027b）**：`PUT/GET /files/verification/:caseId/:documentId`，校验签名（用途+key+过期）、类型白名单与大小上限；生产直连 bucket 时不绑定该路由 |
| ~~G4~~ | ~~会话消息发送/拉取~~ | 小程序「聊天」、导师「聊天」 | **已交付（T027b）**：`POST/GET /conversations/:id/messages`；内容仍在传输适配器（平台只存 `message_refs`），成员/开放状态/双向屏蔽均由服务端校验 |
| G5 | 订单时间线/状态历史 | 订单详情、管理台订单 | 只有当前状态，无流转历史 |
| G6 | 前端事件上报接口 | 首页/漏斗 | 分析事件为服务端埋点（`modules/analytics` 无控制器） |
| G7 | 结算/收入接口 | 导师「Earnings」 | `specs/08` V1 可延后（`settlements` 表未建） |
| G8 | 取消政策读取接口 | 支付页/订单详情 | `orders.policy_snapshot` 当前为 `null`；平台规则可承载但无前端读取口径 |
| G9 | 通知/消息中心（站内信、模板消息订阅） | 全端 | 事件类型已定义但从未发送（T024 记录） |
| G10 | 管理台订单「标记争议」直连接口 | 管理台订单 | `markDispute` 仅服务层存在，对外需经审核处置动作 |
| G11 | 公开类目字典 `GET /taxonomy`（只读） | 筛选面板 | 类目 CRUD 仅管理端 |
| G12 | 儿童信息对导师的**受限**可见接口 | 导师订单页 | `specs/10` 允许"符合条件的订单"下有限可见，当前接口无此通道 |
| G13 | Dashboard 趋势序列（按日/周） | Dashboard | 当前只有计数 `AdminDashboardCounts` |
| G14 | 评价申诉/商家回复 | 评价页 | 评价仅创建，无回复/申诉 |
| G15 | 微信订阅消息/模板消息下发 | 订单状态变更提醒 | 依赖 G9 |

> 上述均为**新增后端能力**，T027 不得自行实现（"不修改现有后端代码"）；需作为后续任务评估。

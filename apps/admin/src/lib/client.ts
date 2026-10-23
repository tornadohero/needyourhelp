import { ENDPOINTS } from '@mentor/api-contracts';
import type {
  AdminAuditLogListResponse,
  AdminDashboardCounts,
  AdminFeatureFlagListResponse,
  AdminFeatureFlagResponse,
  AdminOrderListResponse,
  AdminProviderListResponse,
  AdminRoleChangeResponse,
  AdminUserListResponse,
  AdminVerificationCaseResponse,
  AdminVerificationQueueResponse,
  ConsoleCredentialResponse,
  ConsoleCredentialRevocationResponse,
  LoginResponse,
  MeResponse,
  PlatformRuleListResponse,
  PlatformRuleResponse,
  ProviderProfileResponse,
  RefundResponse,
  TaxonomyTermResponse,
  AdminTaxonomyListResponse,
  VerificationDocumentAccessResponse,
} from '@mentor/api-contracts';

import { apiRequest } from './http';
import type { ApiRequestOptions, Transport } from './http';

/**
 * Every admin use case (T033).
 *
 * The console is a thin operator over the same API the platform uses: no direct
 * database access, no role invented client-side, and every decision carries a
 * reason because the server requires one and the audit log shows it
 * (`specs/12-admin-spec.md`).
 *
 * Two rules shape the money commands:
 * - a refund carries an `Idempotency-Key`, so a double click cannot refund twice;
 * - no amount is invented: an omitted amount means "what the server says is
 *   refundable" (`specs/08-payment-and-settlement.md` §Refund).
 */
export interface AdminClientOptions {
  baseUrl: string;
  transport: Transport;
  accessToken?: string | null;
  requestId?: () => string;
}

export interface AdminClient {
  login(input: { username: string; password: string }): Promise<LoginResponse>;
  me(): Promise<MeResponse>;
  bootstrap(): Promise<AdminRoleChangeResponse>;

  dashboard(): Promise<AdminDashboardCounts>;

  providers(query?: {
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<AdminProviderListResponse>;
  approveProvider(providerId: string, reason: string): Promise<ProviderProfileResponse>;
  rejectProvider(providerId: string, reason: string): Promise<ProviderProfileResponse>;
  suspendProvider(providerId: string, reason: string): Promise<ProviderProfileResponse>;
  restoreProvider(providerId: string, reason: string): Promise<ProviderProfileResponse>;

  verifications(query?: {
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<AdminVerificationQueueResponse>;
  approveVerification(
    caseId: string,
    input: { reasonCode: string; notes?: string },
  ): Promise<AdminVerificationCaseResponse>;
  rejectVerification(
    caseId: string,
    input: { reasonCode: string; notes?: string },
  ): Promise<AdminVerificationCaseResponse>;
  /** Short-lived, audited access to a private document; never cached. */
  documentAccessUrl(
    caseId: string,
    documentId: string,
    options?: { notes?: string },
  ): Promise<VerificationDocumentAccessResponse>;

  orders(query?: {
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<AdminOrderListResponse>;
  refundOrder(
    orderId: string,
    input: { amountMinor?: number; reason?: string },
    idempotencyKey: string,
  ): Promise<RefundResponse>;

  users(query?: { page?: number; pageSize?: number }): Promise<AdminUserListResponse>;
  grantRole(userId: string, role: string): Promise<AdminRoleChangeResponse>;
  revokeRole(userId: string, role: string): Promise<AdminRoleChangeResponse>;

  auditLogs(query?: {
    action?: string;
    /** The API filters by resource **type**, not by id. */
    resourceType?: string;
    page?: number;
    pageSize?: number;
  }): Promise<AdminAuditLogListResponse>;

  featureFlags(): Promise<AdminFeatureFlagListResponse>;
  setFeatureFlag(
    key: string,
    input: { enabled: boolean; configJson?: string },
  ): Promise<AdminFeatureFlagResponse>;

  taxonomy(query?: { type?: string }): Promise<AdminTaxonomyListResponse>;
  createTaxonomyTerm(input: {
    type: string;
    code: string;
    name: string;
  }): Promise<TaxonomyTermResponse>;
  archiveTaxonomyTerm(termId: string): Promise<TaxonomyTermResponse>;

  platformRules(query?: { ruleType?: string }): Promise<PlatformRuleListResponse>;
  createPlatformRule(input: {
    ruleType: string;
    payload: Record<string, unknown>;
  }): Promise<PlatformRuleResponse>;
  publishPlatformRule(ruleId: string): Promise<PlatformRuleResponse>;

  issueCredential(input: {
    userId: string;
    username: string;
    password: string;
  }): Promise<ConsoleCredentialResponse>;
  revokeCredential(userId: string): Promise<ConsoleCredentialRevocationResponse>;
}

/** A call still has to name a path; everything else is optional. */
type CallRequest = Pick<ApiRequestOptions, 'path'> & Omit<Partial<ApiRequestOptions>, 'path'>;

export function createAdminClient(options: AdminClientOptions): AdminClient {
  const call = <T>(request: CallRequest): Promise<T> =>
    apiRequest<T>({
      ...request,
      baseUrl: options.baseUrl,
      transport: options.transport,
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      ...(options.accessToken ? { accessToken: options.accessToken } : {}),
    });

  return {
    login: (input) =>
      call<LoginResponse>({ path: ENDPOINTS.consoleLogin, method: 'POST', body: input }),
    me: () => call<MeResponse>({ path: ENDPOINTS.me }),
    bootstrap: () =>
      call<AdminRoleChangeResponse>({ path: ENDPOINTS.adminBootstrap, method: 'POST' }),

    dashboard: () => call<AdminDashboardCounts>({ path: ENDPOINTS.adminDashboard }),

    providers: (query) =>
      call<AdminProviderListResponse>({ path: ENDPOINTS.adminProviders, query }),
    approveProvider: (providerId, reason) =>
      call<ProviderProfileResponse>({
        path: ENDPOINTS.adminProviderApprove,
        method: 'POST',
        params: { id: providerId },
        body: { reason },
      }),
    rejectProvider: (providerId, reason) =>
      call<ProviderProfileResponse>({
        path: ENDPOINTS.adminProviderReject,
        method: 'POST',
        params: { id: providerId },
        body: { reason },
      }),
    suspendProvider: (providerId, reason) =>
      call<ProviderProfileResponse>({
        path: ENDPOINTS.adminProviderSuspend,
        method: 'POST',
        params: { id: providerId },
        body: { reason },
      }),
    restoreProvider: (providerId, reason) =>
      call<ProviderProfileResponse>({
        path: ENDPOINTS.adminProviderRestore,
        method: 'POST',
        params: { id: providerId },
        body: { reason },
      }),

    verifications: (query) =>
      call<AdminVerificationQueueResponse>({ path: ENDPOINTS.adminVerifications, query }),
    approveVerification: (caseId, input) =>
      call<AdminVerificationCaseResponse>({
        path: ENDPOINTS.adminVerificationApprove,
        method: 'POST',
        params: { id: caseId },
        body: input,
      }),
    rejectVerification: (caseId, input) =>
      call<AdminVerificationCaseResponse>({
        path: ENDPOINTS.adminVerificationReject,
        method: 'POST',
        params: { id: caseId },
        body: input,
      }),
    documentAccessUrl: (caseId, documentId, input = {}) =>
      call<VerificationDocumentAccessResponse>({
        path: ENDPOINTS.adminVerificationDocumentAccess,
        method: 'POST',
        params: { id: caseId, documentId },
        // The reason code is what the audit log records for this access.
        body: { reasonCode: 'REVIEW', ...input },
      }),

    orders: (query) => call<AdminOrderListResponse>({ path: ENDPOINTS.adminOrders, query }),
    refundOrder: (orderId, input, idempotencyKey) =>
      call<RefundResponse>({
        path: ENDPOINTS.adminOrderRefund,
        method: 'POST',
        params: { id: orderId },
        body: input,
        idempotencyKey,
      }),

    users: (query) => call<AdminUserListResponse>({ path: ENDPOINTS.adminUsers, query }),
    grantRole: (userId, role) =>
      call<AdminRoleChangeResponse>({
        path: ENDPOINTS.adminUserRoles,
        method: 'POST',
        params: { id: userId },
        body: { role },
      }),
    revokeRole: (userId, role) =>
      call<AdminRoleChangeResponse>({
        path: ENDPOINTS.adminUserRole,
        method: 'DELETE',
        params: { id: userId, role },
      }),

    auditLogs: (query) =>
      call<AdminAuditLogListResponse>({ path: ENDPOINTS.adminAuditLogs, query }),

    featureFlags: () => call<AdminFeatureFlagListResponse>({ path: ENDPOINTS.adminFeatureFlags }),
    setFeatureFlag: (key, input) =>
      call<AdminFeatureFlagResponse>({
        path: ENDPOINTS.adminFeatureFlag,
        method: 'PATCH',
        params: { key },
        body: input,
      }),

    taxonomy: (query) => call<AdminTaxonomyListResponse>({ path: ENDPOINTS.taxonomy, query }),
    createTaxonomyTerm: (input) =>
      call<TaxonomyTermResponse>({ path: ENDPOINTS.taxonomy, method: 'POST', body: input }),
    archiveTaxonomyTerm: (termId) =>
      call<TaxonomyTermResponse>({
        path: ENDPOINTS.taxonomyTermArchive,
        method: 'POST',
        params: { id: termId },
      }),

    platformRules: (query) =>
      call<PlatformRuleListResponse>({ path: ENDPOINTS.adminPlatformRules, query }),
    createPlatformRule: (input) =>
      call<PlatformRuleResponse>({
        path: ENDPOINTS.adminPlatformRules,
        method: 'POST',
        body: input,
      }),
    publishPlatformRule: (ruleId) =>
      call<PlatformRuleResponse>({
        path: ENDPOINTS.adminPlatformRulePublish,
        method: 'POST',
        params: { id: ruleId },
      }),

    issueCredential: (input) =>
      call<ConsoleCredentialResponse>({
        path: ENDPOINTS.adminConsoleCredentials,
        method: 'POST',
        body: input,
      }),
    revokeCredential: (userId) =>
      call<ConsoleCredentialRevocationResponse>({
        path: ENDPOINTS.adminConsoleCredential,
        method: 'DELETE',
        params: { userId },
      }),
  };
}

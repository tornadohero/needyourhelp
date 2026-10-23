import type { OrderResponse } from '@mentor/api-contracts';

import { describeOrder } from './order-view';
import type { OrderRowView } from './order-view';

import type {
  AvailabilitySlotResponse,
  CapabilityTypeName,
  ComplianceStatusName,
  OrderStatusName,
  DeliveryModeName,
  ProviderApprovalStatus,
  ProviderCapabilityResponse,
  ProviderProfileResponse,
  ServiceResponse,
  ServiceStatusName,
  VerificationCaseResponse,
  VerificationCaseStatusName,
  CapabilityTypeName as CapabilityType,
  VerificationLevelName,
  VerificationTypeName,
} from '@mentor/api-contracts';

import { formatDateTime, formatDuration, formatMoney } from './format';

/**
 * Provider desk view models (T032).
 *
 * The desk is the provider looking at their **own** record, so it may show what
 * the public payload hides: approval status, `searchable`, capability state.
 * What it still never shows is a way to set them — every one of those is a
 * server decision reached through a command (`AGENTS.md` §7, `specs/01`
 * §Provider approval).
 *
 * Money here is the provider's own price, typed by hand; everything the platform
 * computes (fees, payouts, order totals) stays on the server (`AGENTS.md` §8).
 */

export const PROVIDER_APPROVAL_TEXTS: Record<ProviderApprovalStatus, string> = {
  DRAFT: '未提交',
  SUBMITTED: '已提交',
  UNDER_REVIEW: '审核中',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  SUSPENDED: '已暂停',
};

export const CAPABILITY_TEXTS: Record<CapabilityTypeName, string> = {
  STUDENT_TUTOR: '在校生辅导',
  GRADUATE_TUTOR: '研究生辅导',
  PHD_TUTOR: '博士生辅导',
  TEACHER: '在职教师',
  CAREER_MENTOR: '职业导师',
};

export const VERIFICATION_LEVEL_TEXTS: Record<VerificationLevelName, string> = {
  NONE: '未验证',
  IDENTITY: '已验证身份',
  EDUCATION: '已验证学历',
  FULL: '身份与学历均已验证',
};

export const COMPLIANCE_TEXTS: Record<ComplianceStatusName, string> = {
  NOT_REQUIRED: '无需资质',
  PENDING: '待提交',
  UNDER_REVIEW: '审核中',
  APPROVED: '已通过',
  RESTRICTED: '受限',
  REJECTED: '已驳回',
  SUSPENDED: '已暂停',
};

export const SERVICE_STATUS_TEXTS: Record<ServiceStatusName, string> = {
  DRAFT: '草稿',
  PENDING_REVIEW: '待审核',
  PUBLISHED: '已发布',
  REJECTED: '已驳回',
  UNPUBLISHED: '已下架',
};

export const VERIFICATION_TYPE_TEXTS: Record<VerificationTypeName, string> = {
  IDENTITY: '身份认证',
  EDUCATION: '学历认证',
  TEACHER_COMPLIANCE: '教师资质',
};

/**
 * What the desk may offer for a provider record.
 *
 * `searchable` and `approvalStatus` are read, not written: publishing a service
 * is a command the server refuses while the provider is not approved, and the
 * desk says so instead of hiding the button (`specs/01` §Provider approval).
 */
export interface ProviderDeskView {
  id: string;
  name: string;
  headline: string;
  cityText: string;
  serviceModeText: string;
  approvalText: string;
  approvalStatus: ProviderApprovalStatus;
  searchableText: string;
  ratingText: string;
  completedText: string;
  capabilities: CapabilityRowView[];
  /** `true` for a record that can still be handed to a reviewer. */
  canSubmit: boolean;
  /** `false` while approval is missing: publishing would be refused. */
  canPublish: boolean;
}

export interface CapabilityRowView {
  typeText: string;
  statusText: string;
  verificationText: string;
  complianceText: string;
}

export function describeCapability(capability: ProviderCapabilityResponse): CapabilityRowView {
  return {
    typeText: CAPABILITY_TEXTS[capability.capabilityType],
    statusText: PROVIDER_APPROVAL_TEXTS[capability.status],
    verificationText: VERIFICATION_LEVEL_TEXTS[capability.verificationLevel],
    complianceText: COMPLIANCE_TEXTS[capability.complianceStatus],
  };
}

export function describeProviderDesk(profile: ProviderProfileResponse): ProviderDeskView {
  const approved = profile.approvalStatus === 'APPROVED';
  return {
    id: profile.id,
    name: profile.publicName,
    headline: profile.headline ?? '',
    cityText: profile.cityCode ?? '未标注城市',
    serviceModeText: SERVICE_MODE_TEXTS[profile.serviceMode],
    approvalText: PROVIDER_APPROVAL_TEXTS[profile.approvalStatus],
    approvalStatus: profile.approvalStatus,
    // `searchable` is the discovery gate, computed by the server: the desk
    // reports it so a provider understands why they are not in the list yet.
    searchableText: profile.searchable ? '可被搜索到' : '暂未出现在发现页',
    ratingText:
      profile.ratingCount > 0 && profile.ratingAvg !== null
        ? `${profile.ratingAvg.toFixed(1)} 分 · ${profile.ratingCount} 条`
        : '暂无评价',
    completedText: `${profile.completedOrderCount} 次完成`,
    capabilities: profile.capabilities.map(describeCapability),
    canSubmit: profile.approvalStatus === 'DRAFT' || profile.approvalStatus === 'REJECTED',
    canPublish: approved,
  };
}

const SERVICE_MODE_TEXTS = {
  ONLINE: '线上',
  OFFLINE: '线下',
  HYBRID: '线上/线下',
} as const;

/** A service as its owner manages it: what it is, what it costs, and its state. */
export interface ServiceManageRowView {
  id: string;
  title: string;
  description: string;
  durationText: string;
  priceText: string;
  statusText: string;
  status: ServiceStatusName;
  termText: string;
  published: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
}

export function describeServiceRow(service: ServiceResponse): ServiceManageRowView {
  const published = service.status === 'PUBLISHED';
  return {
    id: service.id,
    title: service.title,
    description: service.description ?? '',
    durationText: formatDuration(service.durationMinutes),
    priceText: formatMoney(service.priceMinor),
    statusText: SERVICE_STATUS_TEXTS[service.status],
    status: service.status,
    // The subject tags the compliance check compares against (T007).
    termText: service.terms
      .filter((term) => term.type === 'SUBJECT')
      .map((term) => term.name)
      .join('、'),
    published,
    canPublish: !published,
    canUnpublish: published,
  };
}

/** A slot as its owner manages it. */
export interface SlotManageRowView {
  id: string;
  rangeText: string;
  /** A taken slot cannot be withdrawn: a booking already owns it (T011). */
  deletable: boolean;
}

export function describeSlotRow(slot: AvailabilitySlotResponse): SlotManageRowView {
  return {
    id: slot.id,
    rangeText: `${formatDateTime(slot.startAt)} – ${formatDateTime(slot.endAt)}`,
    deletable: slot.status === 'OPEN',
  };
}

export interface VerificationRowView {
  id: string;
  typeText: string;
  statusText: string;
  submittedText: string;
  documentText: string;
}

export function describeVerificationCase(
  verificationCase: VerificationCaseResponse,
): VerificationRowView {
  return {
    id: verificationCase.id,
    typeText: VERIFICATION_TYPE_TEXTS[verificationCase.verificationType],
    statusText: VERIFICATION_STATUS_TEXTS[verificationCase.status],
    submittedText: verificationCase.submittedAt
      ? formatDateTime(verificationCase.submittedAt)
      : '未提交',
    documentText: `${verificationCase.documents.length} 份材料`,
  };
}

export const VERIFICATION_STATUS_TEXTS: Record<VerificationCaseStatusName, string> = {
  DRAFT: '待上传材料',
  SUBMITTED: '已提交',
  UNDER_REVIEW: '审核中',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  RESUBMITTED: '已重新提交',
};

/**
 * The provider's next command on an order, or `null` when there is none.
 *
 * Mirrors `ORDER_TRANSITIONS` for the three provider commands only. The server
 * still decides: a 409 means the screen is stale and reloads
 * (`specs/06-verification-state-machine.md` §Order).
 */
export type ProviderOrderAction = 'confirm' | 'start' | 'complete';

export function providerNextAction(status: OrderStatusName): ProviderOrderAction | null {
  if (status === 'PAID') {
    return 'confirm';
  }
  if (status === 'CONFIRMED') {
    return 'start';
  }
  if (status === 'IN_PROGRESS') {
    return 'complete';
  }
  return null;
}

export const PROVIDER_ACTION_TEXTS: Record<ProviderOrderAction, string> = {
  confirm: '接单',
  start: '开始服务',
  complete: '完成服务',
};

// ---------------------------------------------------------------------------
// Application form
// ---------------------------------------------------------------------------

/** `POST /providers/applications` bounds, mirroring the server's DTO. */
export const PUBLIC_NAME_MAX = 64;
export const HEADLINE_MAX = 120;
export const BIO_MAX = 2_000;

const CITY_CODE = /^[A-Z0-9_-]+$/;

export interface ProviderApplicationInput {
  publicName: string;
  headline?: string;
  bio?: string;
  cityCode?: string;
  serviceMode?: DeliveryModeName;
  capabilityTypes?: CapabilityType[];
}

/**
 * No `approvalStatus`, no `searchable`, no `userId`, no role: the server decides
 * all of them, and the whitelist refuses them anyway (`AGENTS.md` §7).
 */
export interface CreateApplicationBody {
  publicName: string;
  headline?: string;
  bio?: string;
  cityCode?: string;
  serviceMode?: DeliveryModeName;
  capabilityTypes: CapabilityType[];
}

export type ApplicationProblem = 'NO_PUBLIC_NAME' | 'BAD_CITY' | 'NO_CAPABILITY';

export function applicationProblems(input: ProviderApplicationInput): ApplicationProblem[] {
  const problems: ApplicationProblem[] = [];
  if (input.publicName.trim().length === 0) {
    problems.push('NO_PUBLIC_NAME');
  }
  if (
    input.cityCode !== undefined &&
    input.cityCode.length > 0 &&
    !CITY_CODE.test(input.cityCode)
  ) {
    problems.push('BAD_CITY');
  }
  if ((input.capabilityTypes ?? []).length === 0) {
    problems.push('NO_CAPABILITY');
  }
  return problems;
}

export const APPLICATION_PROBLEM_TEXTS: Record<ApplicationProblem, string> = {
  NO_PUBLIC_NAME: '请填写对外展示的姓名。',
  BAD_CITY: '城市编号格式不正确。',
  NO_CAPABILITY: '请至少选择一项辅导身份。',
};

/** Thrown when an application cannot be sent as it stands. */
export class ApplicationInvalidError extends Error {
  readonly problems: ApplicationProblem[];

  constructor(problems: ApplicationProblem[]) {
    super(`Application is invalid: ${problems.join(', ')}`);
    this.name = 'ApplicationInvalidError';
    this.problems = problems;
  }
}

/**
 * Trimmed and cut to the server's bounds; empty optional fields are dropped
 * rather than sent as empty strings.
 */
export function applicationRequest(input: ProviderApplicationInput): CreateApplicationBody {
  const problems = applicationProblems(input);
  if (problems.length > 0) {
    throw new ApplicationInvalidError(problems);
  }

  const headline = (input.headline ?? '').trim().slice(0, HEADLINE_MAX);
  const bio = (input.bio ?? '').trim().slice(0, BIO_MAX);
  const cityCode = (input.cityCode ?? '').trim();

  return {
    publicName: input.publicName.trim().slice(0, PUBLIC_NAME_MAX),
    ...(headline.length > 0 ? { headline } : {}),
    ...(bio.length > 0 ? { bio } : {}),
    ...(cityCode.length > 0 ? { cityCode } : {}),
    ...(input.serviceMode === undefined ? {} : { serviceMode: input.serviceMode }),
    capabilityTypes: input.capabilityTypes ?? [],
  };
}

// ---------------------------------------------------------------------------
// Orders to deliver
// ---------------------------------------------------------------------------

/** An order row as the provider who has to deliver it sees it. */
export interface ProviderOrderRowView extends OrderRowView {
  action: ProviderOrderAction | null;
  actionText: string;
}

export function describeProviderOrder(order: OrderResponse): ProviderOrderRowView {
  const action = providerNextAction(order.status);
  return {
    ...describeOrder(order),
    action,
    actionText: action === null ? '' : PROVIDER_ACTION_TEXTS[action],
  };
}

/**
 * Keep only the orders this provider has to deliver.
 *
 * `GET /orders` answers every order the account participates in, both as a
 * customer and as a provider, so the desk separates them before rendering.
 */
export function providerOrdersOnly<T extends { providerId: string }>(
  rows: T[],
  providerId: string,
): T[] {
  return rows.filter((row) => row.providerId === providerId);
}

'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';

import { AdminApiError } from './http';
import { anonymousClient, clearSession, clientForSession, rememberLogin } from './server';

/**
 * Operator commands (T033).
 *
 * Every mutation is a server action: the token never reaches the browser and a
 * decision always carries the reason the server records in the audit log
 * (`specs/12-admin-spec.md`).
 *
 * Each action answers either `{ ok: true }` or `{ ok: false, message }` — a
 * thrown platform error is translated into an operator sentence, never echoed
 * raw, and never rendered as a stack trace.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
}

function failed(error: unknown): ActionResult {
  if (error instanceof AdminApiError) {
    return { ok: false, message: error.message };
  }
  return { ok: false, message: '操作失败，请稍后重试。' };
}

/** Console login: proves an existing operator role, never grants one. */
export async function signIn(formData: FormData): Promise<ActionResult> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');

  try {
    const login = await anonymousClient().login({ username, password });
    await rememberLogin(login);
  } catch (error) {
    return failed(error);
  }

  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  await clearSession();
  redirect('/login');
}

/** First administrator: the audited bootstrap, offered once. */
export async function bootstrap(): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await client.bootstrap();
    return { ok: true, message: '已授予管理员角色（已审计）。' };
  } catch (error) {
    return failed(error);
  }
}

export type ProviderDecision = 'approve' | 'reject' | 'suspend' | 'restore';

/** A provider decision; the reason is mandatory and lands in the audit log. */
export async function decideProvider(
  providerId: string,
  decision: ProviderDecision,
  reason: string,
): Promise<ActionResult> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: '请填写理由：该理由会写入审计日志。' };
  }

  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }

    if (decision === 'approve') {
      await client.approveProvider(providerId, trimmed);
    } else if (decision === 'reject') {
      await client.rejectProvider(providerId, trimmed);
    } else if (decision === 'suspend') {
      await client.suspendProvider(providerId, trimmed);
    } else {
      await client.restoreProvider(providerId, trimmed);
    }
    return { ok: true, message: '已提交（已审计）。' };
  } catch (error) {
    return failed(error);
  }
}

/** Approve or reject a verification case. */
export async function decideVerification(
  caseId: string,
  decision: 'approve' | 'reject',
  reasonCode: string,
): Promise<ActionResult> {
  const code = reasonCode.trim();
  if (code.length === 0) {
    return { ok: false, message: '请填写原因代码。' };
  }

  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await (decision === 'approve'
      ? client.approveVerification(caseId, { reasonCode: code })
      : client.rejectVerification(caseId, { reasonCode: code }));
    return { ok: true, message: '已提交（已审计）。' };
  } catch (error) {
    return failed(error);
  }
}

/**
 * A short-lived URL for one document.
 *
 * The console shows it as a link and forgets it: a private document is never
 * cached and the URL expires in minutes (`specs/12`: access is logged).
 */
export async function openDocument(caseId: string, documentId: string): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    const access = await client.documentAccessUrl(caseId, documentId);
    return { ok: true, message: access.downloadUrl };
  } catch (error) {
    return failed(error);
  }
}

/** Refund an order; the idempotency key makes a double click harmless. */
export async function refundOrder(
  orderId: string,
  options: { amountMinor?: number; reason?: string } = {},
): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await client.refundOrder(orderId, options, randomUUID());
    return { ok: true, message: '退款已提交（幂等，可安全重试）。' };
  } catch (error) {
    return failed(error);
  }
}

export async function grantRole(userId: string, role: string): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await client.grantRole(userId, role);
    return { ok: true, message: '已授权（已审计）。' };
  } catch (error) {
    return failed(error);
  }
}

export async function revokeRole(userId: string, role: string): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await client.revokeRole(userId, role);
    return { ok: true, message: '已撤权（已审计）。' };
  } catch (error) {
    return failed(error);
  }
}

/** Toggle a feature flag: audited, and confirmed by the operator first. */
export async function setFlag(key: string, enabled: boolean): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await client.setFeatureFlag(key, { enabled });
    return { ok: true, message: `开关已${enabled ? '开启' : '关闭'}（已审计）。` };
  } catch (error) {
    return failed(error);
  }
}

/** Taxonomy is archived, never deleted (`specs/01` §Catalog). */
export async function archiveTerm(termId: string): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await client.archiveTaxonomyTerm(termId);
    return { ok: true, message: '已归档（不会删除）。' };
  } catch (error) {
    return failed(error);
  }
}

export async function createTerm(input: {
  type: string;
  code: string;
  name: string;
}): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await client.createTaxonomyTerm(input);
    return { ok: true, message: '已创建。' };
  } catch (error) {
    return failed(error);
  }
}

/** Publishing a rule is explicit: it changes what the platform charges. */
export async function publishRule(ruleId: string): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await client.publishPlatformRule(ruleId);
    return { ok: true, message: '规则已发布。' };
  } catch (error) {
    return failed(error);
  }
}

export async function issueCredential(input: {
  userId: string;
  username: string;
  password: string;
}): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await client.issueCredential(input);
    return { ok: true, message: '凭据已签发（已审计）。' };
  } catch (error) {
    return failed(error);
  }
}

export async function revokeCredential(userId: string): Promise<ActionResult> {
  try {
    const client = await clientForSession();
    if (client === null) {
      return { ok: false, message: '请先登录。' };
    }
    await client.revokeCredential(userId);
    return { ok: true, message: '凭据已撤销（已审计）。' };
  } catch (error) {
    return failed(error);
  }
}

/**
 * One entry point for the small forms on every page.
 *
 * A page renders a command as a form; this action reads what the form names and
 * calls the typed command above. The indirection keeps the client bundle to a
 * single reusable form component while every command keeps its own signature and
 * its own reason handling.
 *
 * `id` is always the subject (provider, case, order, user, term, rule) and
 * `text` is always the human reason or value the audit log records.
 */
export async function runCommand(formData: FormData): Promise<ActionResult> {
  const kind = String(formData.get('kind') ?? '');
  const id = String(formData.get('id') ?? '');
  const text = String(formData.get('text') ?? '');
  const extra = String(formData.get('extra') ?? '');

  switch (kind) {
    case 'provider.approve':
      return decideProvider(id, 'approve', text);
    case 'provider.reject':
      return decideProvider(id, 'reject', text);
    case 'provider.suspend':
      return decideProvider(id, 'suspend', text);
    case 'provider.restore':
      return decideProvider(id, 'restore', text);
    case 'verification.approve':
      return decideVerification(id, 'approve', text);
    case 'verification.reject':
      return decideVerification(id, 'reject', text);
    case 'verification.document':
      return openDocument(id, text);
    case 'order.refund':
      return refundOrder(id, {
        reason: text || undefined,
        // An empty amount means "whatever is still refundable": the server says.
        ...(extra.trim().length > 0 ? { amountMinor: Number(extra) } : {}),
      });
    case 'role.grant':
      return grantRole(id, extra);
    case 'role.revoke':
      return revokeRole(id, extra);
    case 'flag.set':
      return setFlag(id, extra === 'true');
    case 'term.archive':
      return archiveTerm(id);
    case 'term.create':
      return createTerm({ type: extra, code: text, name: String(formData.get('name') ?? '') });
    case 'rule.publish':
      return publishRule(id);
    case 'credential.issue':
      return issueCredential({ userId: id, username: text, password: extra });
    case 'credential.revoke':
      return revokeCredential(id);
    case 'admin.bootstrap':
      return bootstrap();
    default:
      return { ok: false, message: '未知操作。' };
  }
}

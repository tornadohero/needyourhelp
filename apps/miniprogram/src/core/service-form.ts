/**
 * Service editor form (T032).
 *
 * A provider sets their own price and duration, so those fields are typed here —
 * that is the one place a client decides money, and it is the provider's
 * decision to make (`specs/01-business-rules.md` §Services). Everything the
 * platform derives from them (fees, payouts, order totals) is still the server's
 * arithmetic (`AGENTS.md` §8).
 *
 * Every bound mirrors the server's own (`apps/api` service policy), so a form
 * that cannot be sent is never sent. The server validates again regardless:
 * these bounds are a convenience, not the contract.
 */

export const SERVICE_TITLE_MAX = 120;
export const SERVICE_DESCRIPTION_MAX = 2_000;
export const MIN_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 480;
export const MIN_PRICE_MINOR = 100;
export const MAX_PRICE_MINOR = 1_000_000;
export const MAX_TERMS = 20;

/** The server's `TERM_CODE_PATTERN`: stable codes, never display names. */
const TERM_CODE = /^[A-Za-z0-9_]{1,64}$/;

export interface ServiceDraft {
  title: string;
  description: string;
  durationMinutes: number | null;
  /** Typed in yuan, because that is what a person means. */
  priceYuan: string;
  subjectCodes: string[];
}

export function newServiceDraft(): ServiceDraft {
  return { title: '', description: '', durationMinutes: null, priceYuan: '', subjectCodes: [] };
}

export function withTitle(draft: ServiceDraft, title: string): ServiceDraft {
  return { ...draft, title: title.trim().slice(0, SERVICE_TITLE_MAX) };
}

export function withDescription(draft: ServiceDraft, description: string): ServiceDraft {
  return { ...draft, description: description.trim().slice(0, SERVICE_DESCRIPTION_MAX) };
}

/** `NaN`, a fraction or an out-of-range length is recorded as "not chosen yet". */
export function withDuration(draft: ServiceDraft, minutes: number): ServiceDraft {
  const valid =
    Number.isInteger(minutes) && minutes >= MIN_DURATION_MINUTES && minutes <= MAX_DURATION_MINUTES;
  return { ...draft, durationMinutes: valid ? minutes : null };
}

export function withPriceYuan(draft: ServiceDraft, priceYuan: string): ServiceDraft {
  return { ...draft, priceYuan: priceYuan.trim() };
}

/**
 * Subject tags the platform compares against teacher compliance scopes (T007).
 *
 * Duplicates are dropped and the cap is honoured, because the server refuses
 * both and a silent rejection is worse than a shorter list.
 */
export function withSubjectCodes(draft: ServiceDraft, codes: string[]): ServiceDraft {
  const cleaned = codes
    .map((code) => code.trim())
    .filter((code) => TERM_CODE.test(code))
    .filter((code, index, all) => all.indexOf(code) === index)
    .slice(0, MAX_TERMS);
  return { ...draft, subjectCodes: cleaned };
}

export type ServiceProblem =
  'NO_TITLE' | 'NO_DURATION' | 'NO_PRICE' | 'PRICE_TOO_SMALL' | 'PRICE_TOO_LARGE' | 'NO_SUBJECT';

export function serviceProblems(draft: ServiceDraft): ServiceProblem[] {
  const problems: ServiceProblem[] = [];
  if (draft.title.length === 0) {
    problems.push('NO_TITLE');
  }
  if (draft.durationMinutes === null) {
    problems.push('NO_DURATION');
  }

  const price = yuanToMinor(draft.priceYuan);
  if (price === null) {
    problems.push('NO_PRICE');
  } else if (price < MIN_PRICE_MINOR) {
    problems.push('PRICE_TOO_SMALL');
  } else if (price > MAX_PRICE_MINOR) {
    problems.push('PRICE_TOO_LARGE');
  }

  if (draft.subjectCodes.length === 0) {
    problems.push('NO_SUBJECT');
  }
  return problems;
}

export const SERVICE_PROBLEM_TEXTS: Record<ServiceProblem, string> = {
  NO_TITLE: '请填写服务名称。',
  NO_DURATION: `时长需为 ${MIN_DURATION_MINUTES}–${MAX_DURATION_MINUTES} 分钟。`,
  NO_PRICE: '价格需为数字，最多两位小数。',
  PRICE_TOO_SMALL: `价格不得低于 ${minorToYuan(MIN_PRICE_MINOR)} 元。`,
  PRICE_TOO_LARGE: `价格不得高于 ${minorToYuan(MAX_PRICE_MINOR)} 元。`,
  NO_SUBJECT: '请至少选择一个科目。',
};

/**
 * "200" → 20000, "200.5" → 20050.
 *
 * Parsed by hand rather than with `parseFloat` + rounding: a float would let
 * `0.1 + 0.2`-style drift reach the wire, and money here must be an exact
 * integer of minor units. Anything else — a sign, a third decimal, letters — is
 * refused instead of rounded.
 */
export function yuanToMinor(text: string): number | null {
  const value = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return null;
  }

  const [yuan, cents = ''] = value.split('.');
  const minor = Number(yuan) * 100 + Number(cents.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 20000 → "200.00", for showing a price back in a form. */
export function minorToYuan(minor: number): string {
  const absolute = Math.abs(Math.trunc(minor));
  return `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** `POST /providers/me/services` — and nothing the server does not accept. */
export interface CreateServiceBody {
  title: string;
  durationMinutes: number;
  priceMinor: number;
  subjectCodes: string[];
  description?: string;
}

/** Thrown when a draft cannot be turned into a request. */
export class ServiceInvalidError extends Error {
  readonly problems: ServiceProblem[];

  constructor(problems: ServiceProblem[]) {
    super(`Service is invalid: ${problems.join(', ')}`);
    this.name = 'ServiceInvalidError';
    this.problems = problems;
  }
}

export function serviceRequest(draft: ServiceDraft): CreateServiceBody {
  const problems = serviceProblems(draft);
  if (problems.length > 0) {
    throw new ServiceInvalidError(problems);
  }

  const priceMinor = yuanToMinor(draft.priceYuan);
  if (priceMinor === null) {
    throw new ServiceInvalidError(['NO_PRICE']);
  }

  return {
    title: draft.title,
    durationMinutes: draft.durationMinutes as number,
    priceMinor,
    subjectCodes: draft.subjectCodes,
    ...(draft.description.length > 0 ? { description: draft.description } : {}),
  };
}

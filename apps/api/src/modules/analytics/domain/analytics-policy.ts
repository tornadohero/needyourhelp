import {
  ANALYTICS_EVENT_NAMES,
  PARENT_FUNNEL_EVENTS,
  PROVIDER_FUNNEL_EVENTS,
  type AnalyticsEventName,
  type AnalyticsFunnelName,
} from '@mentor/api-contracts';

import { hmacHex } from '../../../common/security/hash';
import type { AnalyticsProps } from './analytics-event.model';
import { analyticsInvalidEvent } from './analytics.errors';

/**
 * The analytics rules (`specs/15-analytics-spec.md`,
 * `specs/10-privacy-and-minors.md` §Child profile rules).
 *
 * One rule dominates this file: **a child's name or identity is never an
 * analytics dimension**. Everything that could carry it — a child id, a name, a
 * birth date, a school, a contact detail, a document reference — is refused
 * before an event can leave the process, so a funnel can never be sliced by who
 * the child is.
 */

/**
 * Dimensions that are refused by name.
 *
 * A child is never a dimension — not their id, not their name, not their
 * profile. `has_child` is allowed: it says that a booking involved a child
 * without saying which child.
 */
export const FORBIDDEN_PROP_KEYS = [
  'child',
  'child_id',
  'child_name',
  'child_profile_id',
  'minor_id',
  'student',
  'student_id',
  'student_name',
  'pupil_id',
  'guardian_id',
  'guardian_name',
  'parent_name',
  'user_id',
  'buyer_id',
  'nickname',
  'display_name',
  'real_name',
] as const;

/**
 * Key fragments that must never appear in an event.
 *
 * Checked as substrings, so `studentName`, `childNickname` and
 * `guardianPhone` are all caught by the same rule. `minor` is deliberately
 * absent: it is part of how money is named (`amount_minor`).
 */
export const FORBIDDEN_PROP_KEY_FRAGMENTS = [
  'name',
  'phone',
  'mobile',
  'email',
  'address',
  'wechat',
  'openid',
  'unionid',
  'identity',
  'idcard',
  'id_card',
  'birth',
  'school',
  'grade',
  'document',
  'certificate',
  'avatar',
  'photo',
  'content',
  'message',
  'note',
  'reason',
  'description',
] as const;

export const MAX_PROP_KEYS = 20;
export const MAX_PROP_KEY_LENGTH = 40;
export const MAX_PROP_VALUE_LENGTH = 200;

/** The salt purpose of the actor hash: stable, and never a secret by itself. */
const ACTOR_HASH_PEPPER = 'analytics-actor';

export function isKnownEvent(name: string): name is AnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly string[]).includes(name);
}

export function funnelOf(name: AnalyticsEventName): AnalyticsFunnelName {
  // `order_completed` is the end of both paths; the parent funnel owns it.
  if ((PARENT_FUNNEL_EVENTS as readonly string[]).includes(name)) {
    return 'parent';
  }
  if ((PROVIDER_FUNNEL_EVENTS as readonly string[]).includes(name)) {
    return 'provider';
  }
  return 'parent';
}

export function assertEventName(name: string): AnalyticsEventName {
  if (!isKnownEvent(name)) {
    throw analyticsInvalidEvent(`Unknown analytics event ${name}.`);
  }
  return name;
}

/**
 * The gate behind the acceptance criterion of T020.
 *
 * Refuses anything that could be, or carry, the identity of a person — and
 * above all of a child.
 */
export function assertProps(props: AnalyticsProps | undefined): AnalyticsProps {
  if (!props) {
    return {};
  }

  const keys = Object.keys(props);
  if (keys.length > MAX_PROP_KEYS) {
    throw analyticsInvalidEvent(`An analytics event carries at most ${MAX_PROP_KEYS} dimensions.`);
  }

  const accepted: AnalyticsProps = {};
  for (const key of keys) {
    // Camel case is normalised first, so `childId` is judged as `child_id`
    // and cannot slip past the rule by spelling.
    const normalized = key
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(normalized)) {
      throw analyticsInvalidEvent(`Invalid analytics dimension ${key}.`);
    }
    if (normalized.length > MAX_PROP_KEY_LENGTH) {
      throw analyticsInvalidEvent(`Invalid analytics dimension ${key}.`);
    }
    const forbidden =
      (FORBIDDEN_PROP_KEYS as readonly string[]).includes(normalized) ||
      FORBIDDEN_PROP_KEY_FRAGMENTS.find((fragment) => normalized.includes(fragment));
    if (forbidden) {
      throw analyticsInvalidEvent(
        `The dimension ${key} is not allowed: personal data is never an analytics dimension.`,
      );
    }

    const value = props[key];
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw analyticsInvalidEvent(
        `The dimension ${key} must be a string, number, boolean or null.`,
      );
    }
    if (typeof value === 'string' && value.length > MAX_PROP_VALUE_LENGTH) {
      throw analyticsInvalidEvent(
        `The dimension ${key} must be at most ${MAX_PROP_VALUE_LENGTH} characters.`,
      );
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw analyticsInvalidEvent(`The dimension ${key} must be a finite number.`);
    }

    accepted[normalized] = value ?? null;
  }

  return accepted;
}

/**
 * Actors are counted, not named: the account becomes a keyed hash, the same way
 * an IP is hashed for the audit log (`AGENTS.md` §9).
 */
export function hashActorId(userId: string | null | undefined): string | null {
  if (!userId) {
    return null;
  }
  return hmacHex(userId, ACTOR_HASH_PEPPER);
}

import type { ChildConsentStatus, ChildProfileResponse } from '@mentor/api-contracts';

/**
 * Child picker (T031).
 *
 * `GET /me/children` is the guardian's own list, so a nickname may be shown to
 * the guardian who owns it. Nothing else is: no school, no learning goals, no
 * birth year — a booking needs to know *which* child, not *who* the child is
 * (`specs/10-privacy-and-minors.md`).
 *
 * A child without granted consent cannot be attached to an order: the server
 * refuses the booking, and the picker says so beforehand.
 */

const CONSENT_TEXTS: Record<ChildConsentStatus, string> = {
  PENDING: '待授权',
  GRANTED: '已授权',
  REVOKED: '已撤回授权',
};

export interface ChildRowView {
  id: string;
  name: string;
  gradeText: string;
  consentText: string;
  selectable: boolean;
}

export function describeChild(child: ChildProfileResponse): ChildRowView {
  return {
    id: child.id,
    name: child.nickname,
    gradeText: child.gradeCode ?? '未填年级',
    consentText: CONSENT_TEXTS[child.consentStatus],
    selectable: child.consentStatus === 'GRANTED',
  };
}

/** The children a booking may attach. */
export function selectableChildren(children: ChildRowView[]): ChildRowView[] {
  return children.filter((child) => child.selectable);
}

/** The reason a picker would refuse a child, or `null` when it would not. */
export function refusalOf(child: ChildRowView): string | null {
  return child.selectable ? null : `该孩子${child.consentText}，需先完成监护人授权。`;
}

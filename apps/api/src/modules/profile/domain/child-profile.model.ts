/**
 * Domain view of `child_profiles` (`specs/04-database-spec.md` §child_profiles).
 *
 * Child profiles are private by design: no phone number, no exact address and no
 * identity document is ever modelled (`specs/10-privacy-and-minors.md`
 * §Child profile rules). A profile belongs to exactly one guardian account and
 * is soft-deleted so order history stays intact.
 */
export type ChildConsentStatus = 'PENDING' | 'GRANTED' | 'REVOKED';

export interface ChildProfile {
  id: string;
  guardianUserId: string;
  nickname: string;
  birthYear: number | null;
  gradeCode: string | null;
  /** Private: only ever returned to the guardian (`specs/07-permission-spec.md`). */
  schoolName: string | null;
  learningGoals: string | null;
  dataProcessingConsentStatus: ChildConsentStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateChildProfileInput {
  guardianUserId: string;
  nickname: string;
  birthYear?: number | null;
  gradeCode?: string | null;
  schoolName?: string | null;
  learningGoals?: string | null;
  dataProcessingConsentStatus: ChildConsentStatus;
}

export interface UpdateChildProfileInput {
  nickname?: string;
  birthYear?: number | null;
  gradeCode?: string | null;
  schoolName?: string | null;
  learningGoals?: string | null;
}

/** A deleted profile is invisible to every read path. */
export function isVisible(child: ChildProfile): boolean {
  return child.deletedAt === null;
}

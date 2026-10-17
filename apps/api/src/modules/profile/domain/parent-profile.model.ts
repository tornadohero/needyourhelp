/**
 * Domain view of `parent_profiles` (`specs/04-database-spec.md` §parent_profiles).
 *
 * One profile per account (`user_id` unique): the guardian record behind
 * `GET|PUT /me/profile`.
 */
export interface ParentProfile {
  id: string;
  userId: string;
  displayName: string;
  cityCode: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertParentProfileInput {
  userId: string;
  displayName: string;
  cityCode?: string | null;
  timezone?: string;
}

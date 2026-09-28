import type { ErrorCode } from './error-codes';

/**
 * Wire envelope for every JSON response.
 *
 * Source of truth: `tests/api-contract-examples.md`.
 * `specs/03-architecture-spec.md` shows a flat error body; that inconsistency is a known
 * open decision — this module is the single place to change if the flat form is ratified.
 */
export interface ApiSuccessResponse<TData> {
  data: TData;
  requestId: string;
}

export interface ApiErrorBody {
  code: ErrorCode | string;
  message: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
  requestId: string;
}

export function successEnvelope<TData>(data: TData, requestId: string): ApiSuccessResponse<TData> {
  return { data, requestId };
}

export function errorEnvelope(
  code: ErrorCode | string,
  message: string,
  requestId: string,
): ApiErrorResponse {
  return { error: { code, message }, requestId };
}

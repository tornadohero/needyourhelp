/**
 * The mini program's portable surface (T035).
 *
 * Everything the three-end E2E drives is here: the HTTP client, the session, and
 * the use cases. Pages are **not** exported — they are WeChat lifecycle objects,
 * and a test has no business constructing them.
 *
 * Nothing in this barrel touches `wx`: the platform adapter is injected, which
 * is exactly why the same code can run in Node against a real server.
 */
export { ApiClient } from './core/http';
export type { Transport, TransportRequest, TransportResponse } from './core/http';
export { MemoryTokenStore, SessionManager } from './core/session';
export type { SessionTokens } from './core/session';
export { ROUTES } from './core/routes';

export {
  newBookingDraft,
  slotOptions,
  withChild,
  withNote,
  withService,
  withSlot,
} from './core/booking';
export { describeChild } from './core/children';
export { describeOrder, describeOrderDetail } from './core/order-view';
export { describeProviderDesk, providerOrdersOnly, providerNextAction } from './core/provider-desk';
export {
  newServiceDraft,
  withDuration,
  withPriceYuan,
  withSubjectCodes,
  withTitle,
} from './core/service-form';
export { slotWindow } from './core/slot-form';

export { createMentorContext, ensureContext } from './app-context';
export type { MentorContext } from './app-context';

export * as authService from './services/auth';
export * as discoveryService from './services/discovery';
export * as ordersService from './services/orders';
export * as profileService from './services/profile';
export * as providerDeskService from './services/provider-desk';
export * as verificationService from './services/verification';

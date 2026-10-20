import { describe, expect, it } from 'vitest';

import { ENDPOINTS } from '@mentor/api-contracts';

import { ROUTES, apiUrl, fillPath, queryString } from './routes';

/**
 * Drift guard.
 *
 * The mini program carries its own copy of the paths so it needs no runtime
 * dependency; this test is what keeps that copy honest. A rename on the server
 * fails here, not in a user's hands.
 */
describe('ROUTES', () => {
  it('matches the contract for every endpoint it uses', () => {
    expect(ROUTES.health).toBe(ENDPOINTS.health);
    expect(ROUTES.healthReady).toBe(ENDPOINTS.healthReady);
    expect(ROUTES.auth.wechatLogin).toBe(ENDPOINTS.auth.wechatLogin);
    expect(ROUTES.auth.refresh).toBe(ENDPOINTS.auth.refresh);
    expect(ROUTES.auth.logout).toBe(ENDPOINTS.auth.logout);
    expect(ROUTES.me).toBe(ENDPOINTS.me);
    expect(ROUTES.meProfile).toBe(ENDPOINTS.meProfile);
    expect(ROUTES.meChildren).toBe(ENDPOINTS.meChildren);
    expect(ROUTES.meConsents).toBe(ENDPOINTS.meConsents);
    // Derived route: it must keep pointing inside the consents collection.
    expect(ROUTES.meConsent).toBe(`${ENDPOINTS.meConsents}/:consentType`);
    expect(ROUTES.providers).toBe(ENDPOINTS.providers);
    expect(ROUTES.providerApplications).toBe(ENDPOINTS.providerApplications);
    expect(ROUTES.providerMe).toBe(ENDPOINTS.providerMe);
    expect(ROUTES.providerSubmit).toBe(ENDPOINTS.providerSubmit);
    expect(ROUTES.providerMyServices).toBe(ENDPOINTS.providerServices);
    expect(ROUTES.providerMyAvailability).toBe(ENDPOINTS.providerAvailability);
    expect(ROUTES.conversations).toBe(ENDPOINTS.conversations);
    expect(ROUTES.conversationMessages).toBe(ENDPOINTS.conversationMessages);
    expect(ROUTES.orders).toBe(ENDPOINTS.orders);
    expect(ROUTES.paymentSession).toBe(ENDPOINTS.paymentSession);
    expect(ROUTES.paymentStatus).toBe(ENDPOINTS.paymentStatus);
    expect(ROUTES.orderRefundRequest).toBe(ENDPOINTS.orderRefundRequest);
    expect(ROUTES.orderRefunds).toBe(ENDPOINTS.orderRefunds);
    expect(ROUTES.orderReviews).toBe(ENDPOINTS.orderReviews);
    expect(ROUTES.providerReviews).toBe(ENDPOINTS.providerReviews);
    expect(ROUTES.reports).toBe(ENDPOINTS.reports);
    expect(ROUTES.myReports).toBe(ENDPOINTS.myReports);
    expect(ROUTES.reportAppeal).toBe(ENDPOINTS.reportAppeal);
    expect(ROUTES.verificationCases).toBe(ENDPOINTS.verificationCases);
    expect(ROUTES.verificationMe).toBe(ENDPOINTS.verificationMe);
  });
});

describe('fillPath', () => {
  it('replaces a placeholder and encodes the value', () => {
    expect(fillPath('/orders/:id', { id: 'abc 123' })).toBe('/orders/abc%20123');
  });

  it('refuses to send an unfilled placeholder', () => {
    // `/orders/:id` is not a URL: failing loudly beats a confusing 404.
    expect(() => fillPath('/orders/:id')).toThrow();
  });
});

describe('queryString', () => {
  it('skips undefined values and encodes the rest', () => {
    expect(queryString({ city: 'BEIJING', page: 1, subject: undefined })).toBe(
      '?city=BEIJING&page=1',
    );
  });

  it('returns nothing for an empty query', () => {
    expect(queryString({})).toBe('');
    expect(apiUrl('/providers')).toBe('/providers');
  });
});

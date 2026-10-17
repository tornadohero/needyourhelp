import { describe, expect, it } from 'vitest';

import {
  MAX_PROP_KEYS,
  assertEventName,
  assertProps,
  funnelOf,
  hashActorId,
  isKnownEvent,
} from '../../../src/modules/analytics/domain/analytics-policy';
import { childPresence } from '../../../src/modules/analytics/domain/analytics-event.model';

describe('analytics policy', () => {
  it('refuses every dimension that could be, or carry, a child', () => {
    // The acceptance criterion of T020: a child is never a dimension.
    for (const key of [
      'child',
      'child_id',
      'childId',
      'child_name',
      'childNickname',
      'child_birth_date',
      'child_grade',
      'child_school',
      'student_id',
      'studentName',
      'pupil_id',
      'minor_id',
      'guardian_id',
      'guardianName',
      'parent_name',
    ]) {
      expect(() => assertProps({ [key]: 'x' }), key).toThrow(/not allowed/);
    }
  });

  it('refuses contact details, documents and free text', () => {
    for (const key of [
      'phone',
      'mobile_number',
      'email',
      'home_address',
      'wechat_openid',
      'openid',
      'unionid',
      'id_card',
      'idcard_number',
      'identity_no',
      'document_ref',
      'certificate_id',
      'avatar_url',
      'photo_url',
      'review_content',
      'message_body',
      'moderator_note',
      'reject_reason',
      'description',
      'user_id',
      'buyer_id',
      'display_name',
    ]) {
      expect(() => assertProps({ [key]: 'x' }), key).toThrow(/not allowed/);
    }
  });

  it('allows metrics that say nothing about a person', () => {
    // `has_child` says a booking involved a child, not which child.
    expect(assertProps({ has_child: true })).toEqual({ has_child: true });
    expect(assertProps({ amount_minor: 20_000 })).toEqual({ amount_minor: 20_000 });
    expect(assertProps({ result_count: 3, price_minor: 100, rating: 5 })).toEqual({
      result_count: 3,
      price_minor: 100,
      rating: 5,
    });
    expect(childPresence('child-1')).toEqual({ has_child: true });
    expect(childPresence(null)).toEqual({ has_child: false });
  });

  it('keeps the dimensions flat, primitive and bounded', () => {
    expect(assertProps(undefined)).toEqual({});
    expect(assertProps({ Rating: 5 })).toEqual({ rating: 5 });
    expect(assertProps({ empty: null })).toEqual({ empty: null });

    expect(assertProps({ Rating: 5 })).toEqual({ rating: 5 });
    expect(assertProps({ hasChild: true })).toEqual({ has_child: true });
    expect(() => assertProps({ '1abc': 1 })).toThrow(/dimension/);
    expect(() => assertProps({ 'has space': 1 })).toThrow(/dimension/);
    expect(() => assertProps({ 'has-dash': 1 })).toThrow(/dimension/);
    expect(() => assertProps({ nested: { a: 1 } as never })).toThrow(/string, number, boolean/);
    expect(() => assertProps({ text: 'x'.repeat(201) })).toThrow(/at most/);
    expect(() => assertProps({ value: Number.NaN })).toThrow(/finite/);
    expect(() =>
      assertProps(
        Object.fromEntries(Array.from({ length: MAX_PROP_KEYS + 1 }, (_, i) => [`k${i}`, i])),
      ),
    ).toThrow(/at most/);
  });

  it('knows the events of specs/15 and which funnel they belong to', () => {
    expect(isKnownEvent('order_created')).toBe(true);
    expect(isKnownEvent('service_published')).toBe(true);
    expect(isKnownEvent('page_viewed')).toBe(false);
    expect(() => assertEventName('page_viewed')).toThrow(/Unknown analytics event/);

    expect(funnelOf('provider_detail_viewed')).toBe('parent');
    expect(funnelOf('application_submitted')).toBe('provider');
    // One delivery ends both funnels; the parent owns the shared event.
    expect(funnelOf('order_completed')).toBe('parent');
  });

  it('counts actors without naming them', () => {
    const hash = hashActorId('user-1');
    expect(hash).not.toBe('user-1');
    expect(hash).toHaveLength(64);
    // Stable, so the same visitor is the same visitor across events.
    expect(hashActorId('user-1')).toBe(hash);
    expect(hashActorId('user-2')).not.toBe(hash);
    expect(hashActorId(null)).toBeNull();
  });
});

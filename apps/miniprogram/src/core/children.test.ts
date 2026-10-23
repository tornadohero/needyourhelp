import type { ChildProfileResponse } from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import { describeChild, refusalOf, selectableChildren } from './children';

function child(overrides: Partial<ChildProfileResponse> = {}): ChildProfileResponse {
  return {
    id: 'child-1',
    nickname: '小明',
    birthYear: 2014,
    gradeCode: 'G7',
    schoolName: '某中学',
    learningGoals: '数学基础',
    consentStatus: 'GRANTED',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('describeChild', () => {
  it('shows a nickname and a grade, and nothing else the profile carries', () => {
    const view = describeChild(child());

    expect(view.name).toBe('小明');
    expect(view.gradeText).toBe('G7');

    // The picker needs to know which child, not who they are (`specs/10`).
    const rendered = JSON.stringify(view);
    expect(rendered).not.toContain('某中学');
    expect(rendered).not.toContain('数学基础');
    expect(rendered).not.toContain('2014');
  });

  it('says "未填年级" instead of showing an empty field', () => {
    expect(describeChild(child({ gradeCode: null })).gradeText).toBe('未填年级');
  });

  it('names the consent state, because it decides whether booking is allowed', () => {
    expect(describeChild(child({ consentStatus: 'GRANTED' })).consentText).toBe('已授权');
    expect(describeChild(child({ consentStatus: 'PENDING' })).consentText).toBe('待授权');
    expect(describeChild(child({ consentStatus: 'REVOKED' })).consentText).toBe('已撤回授权');
  });
});

describe('selectableChildren', () => {
  it('offers only children whose guardian consent was granted', () => {
    const views = [
      describeChild(child({ id: 'granted', consentStatus: 'GRANTED' })),
      describeChild(child({ id: 'pending', consentStatus: 'PENDING' })),
      describeChild(child({ id: 'revoked', consentStatus: 'REVOKED' })),
    ];

    expect(selectableChildren(views).map((view) => view.id)).toEqual(['granted']);
  });
});

describe('refusalOf', () => {
  it('explains why a child cannot be attached, and is silent otherwise', () => {
    expect(refusalOf(describeChild(child({ consentStatus: 'GRANTED' })))).toBeNull();
    expect(refusalOf(describeChild(child({ consentStatus: 'REVOKED' })))).toContain('授权');
  });
});

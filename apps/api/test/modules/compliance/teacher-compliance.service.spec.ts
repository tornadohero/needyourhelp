import { beforeEach, describe, expect, it } from 'vitest';

import { TeacherComplianceService } from '../../../src/modules/compliance/application/teacher-compliance.service';
import {
  FakeAuditLogRepository,
  FakeProviderCapabilityRepository,
  FakeProviderProfileRepository,
} from '../provider/fakes';

const ADMIN = 'admin-1';
const REQUEST_ID = 'req-91';

function build() {
  const capabilities = new FakeProviderCapabilityRepository();
  const profiles = new FakeProviderProfileRepository();
  const audit = new FakeAuditLogRepository();
  const service = new TeacherComplianceService(capabilities, profiles, audit);
  return { service, capabilities, profiles, audit };
}

type Context = ReturnType<typeof build>;

/** A provider with a teacher capability pending review and a plain tutor one. */
async function newTeacherProvider(context: Context, publicName = '王老师') {
  const userId = `user-${publicName}`;
  const profile = await context.profiles.create({
    userId,
    providerType: 'TUTORING',
    publicName,
  });
  const [teacher, tutor] = await context.capabilities.createMany([
    {
      providerId: profile.id,
      capabilityType: 'TEACHER',
      status: 'APPROVED',
      verificationLevel: 'FULL',
      complianceStatus: 'PENDING',
    },
    {
      providerId: profile.id,
      capabilityType: 'GRADUATE_TUTOR',
      complianceStatus: 'NOT_REQUIRED',
    },
  ]);
  return { profile, teacher: teacher!, tutor: tutor! };
}

describe('TeacherComplianceService', () => {
  let context: Context;

  beforeEach(() => {
    context = build();
  });

  it('starts a review and audits it', async () => {
    const { teacher } = await newTeacherProvider(context);

    const item = await context.service.startReview(teacher.id, {
      actorUserId: ADMIN,
      reasonCode: 'EMPLOYMENT_CHECK',
      requestId: REQUEST_ID,
    });

    expect(item.capability.complianceStatus).toBe('UNDER_REVIEW');
    expect(item.providerName).toBe('王老师');

    const row = context.audit.find('COMPLIANCE_REVIEW_STARTED');
    expect(row?.actorUserId).toBe(ADMIN);
    expect(row?.actorType).toBe('ADMIN');
    expect(row?.resourceType).toBe('provider_capability');
    expect(row?.resourceId).toBe(teacher.id);
    expect(row?.beforeJson).toMatchObject({ complianceStatus: 'PENDING' });
    expect(row?.afterJson).toMatchObject({
      complianceStatus: 'UNDER_REVIEW',
      reasonCode: 'EMPLOYMENT_CHECK',
    });
  });

  it('approves a teacher and clears any previous restriction', async () => {
    const { teacher } = await newTeacherProvider(context);
    await context.capabilities.update(teacher.id, {
      complianceStatus: 'RESTRICTED',
      restrictionJson: { allowedSubjectCodes: ['MATH'] },
    });

    const item = await context.service.approve(teacher.id, {
      actorUserId: ADMIN,
      reasonCode: 'COMPLIANCE_VERIFIED',
      notes: '在职证明已核验',
      requestId: REQUEST_ID,
      ipHash: 'ip-hash',
    });

    expect(item.capability.complianceStatus).toBe('APPROVED');
    expect(item.capability.restrictionJson).toBeNull();

    const row = context.audit.find('COMPLIANCE_APPROVED');
    expect(row?.ipHash).toBe('ip-hash');
    expect(row?.requestId).toBe(REQUEST_ID);
    expect(row?.afterJson).toMatchObject({ notes: '在职证明已核验', restriction: null });
  });

  it('restricts a teacher to a configurable scope', async () => {
    const { teacher } = await newTeacherProvider(context);

    const item = await context.service.restrict(teacher.id, {
      actorUserId: ADMIN,
      reasonCode: 'SCOPE_LIMITED',
      requestId: REQUEST_ID,
      restriction: { allowedSubjectCodes: ['math'], allowedCityCodes: ['BEIJING'] },
    });

    expect(item.capability.complianceStatus).toBe('RESTRICTED');
    expect(item.capability.restrictionJson).toEqual({
      allowedSubjectCodes: ['MATH'],
      allowedCityCodes: ['BEIJING'],
    });

    const row = context.audit.find('COMPLIANCE_RESTRICTED');
    expect(row?.afterJson).toMatchObject({
      complianceStatus: 'RESTRICTED',
      restriction: { allowedSubjectCodes: ['MATH'], allowedCityCodes: ['BEIJING'] },
    });
  });

  it('rejects and suspends with an audit row', async () => {
    const { teacher } = await newTeacherProvider(context);

    const rejected = await context.service.reject(teacher.id, {
      actorUserId: ADMIN,
      reasonCode: 'EMPLOYED_TEACHER_RESTRICTION',
      requestId: REQUEST_ID,
    });
    expect(rejected.capability.complianceStatus).toBe('REJECTED');
    expect(context.audit.find('COMPLIANCE_REJECTED')?.afterJson).toMatchObject({
      complianceStatus: 'REJECTED',
    });

    // A rejection re-enters review before it can be approved again.
    await context.service.startReview;
    await context.capabilities.update(teacher.id, { complianceStatus: 'PENDING' });
    await context.service.approve(teacher.id, {
      actorUserId: ADMIN,
      reasonCode: 'REVIEWED_AGAIN',
      requestId: REQUEST_ID,
    });

    const suspended = await context.service.suspend(teacher.id, {
      actorUserId: ADMIN,
      reasonCode: 'POLICY_CHANGE',
      requestId: REQUEST_ID,
    });
    expect(suspended.capability.complianceStatus).toBe('SUSPENDED');
    expect(context.audit.find('COMPLIANCE_SUSPENDED')).toBeDefined();
  });

  it('requires a reason code for every decision', async () => {
    const { teacher } = await newTeacherProvider(context);

    await expect(
      context.service.approve(teacher.id, {
        actorUserId: ADMIN,
        reasonCode: '  ',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

    await expect(
      context.service.restrict(teacher.id, {
        actorUserId: ADMIN,
        reasonCode: '   ',
        requestId: REQUEST_ID,
        restriction: { allowedCityCodes: ['BEIJING'] },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(context.audit.rows).toHaveLength(0);
  });

  it('refuses a decision on a capability that needs no compliance', async () => {
    const { tutor } = await newTeacherProvider(context);

    await expect(
      context.service.approve(tutor.id, {
        actorUserId: ADMIN,
        reasonCode: 'OK',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses illegal transitions and unknown capabilities', async () => {
    const { teacher } = await newTeacherProvider(context);

    await expect(
      context.service.startReview(teacher.id, {
        actorUserId: ADMIN,
        reasonCode: 'OK',
        requestId: REQUEST_ID,
      }),
    ).resolves.toBeDefined();
    await context.service.approve(teacher.id, {
      actorUserId: ADMIN,
      reasonCode: 'OK',
      requestId: REQUEST_ID,
    });

    // APPROVED -> APPROVED is not a transition.
    await expect(
      context.service.approve(teacher.id, {
        actorUserId: ADMIN,
        reasonCode: 'OK',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      context.service.approve('missing', {
        actorUserId: ADMIN,
        reasonCode: 'OK',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('lists only teacher capabilities awaiting review', async () => {
    const first = await newTeacherProvider(context, '王老师');
    const second = await newTeacherProvider(context, '李老师');

    const queue = await context.service.listQueue({ limit: 10 });

    expect(queue).toHaveLength(2);
    expect(queue.map((item) => item.capability.id).sort()).toEqual(
      [first.teacher.id, second.teacher.id].sort(),
    );
    expect(queue.every((item) => item.capability.capabilityType === 'TEACHER')).toBe(true);
    expect(queue.some((item) => item.providerName === '李老师')).toBe(true);

    // The tutor capability never enters the compliance queue.
    const pending = await context.service.listQueue({ status: ['PENDING'], limit: 10 });
    expect(pending).toHaveLength(2);
    expect(await context.service.listQueue({ status: ['APPROVED'], limit: 10 })).toHaveLength(0);
    expect(await context.service.listQueue({ limit: 1 })).toHaveLength(1);
  });
});

describe('orderability gate', () => {
  let context: Context;

  beforeEach(() => {
    context = build();
  });

  it('blocks a teacher whose compliance is pending', async () => {
    const { profile } = await newTeacherProvider(context);

    await expect(context.service.assertOrderable(profile.id, 'TEACHER')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('permits a teacher once compliance is approved', async () => {
    const { profile, teacher } = await newTeacherProvider(context);
    await context.service.approve(teacher.id, {
      actorUserId: ADMIN,
      reasonCode: 'COMPLIANCE_VERIFIED',
      requestId: REQUEST_ID,
    });

    await expect(context.service.assertOrderable(profile.id, 'TEACHER')).resolves.toMatchObject({
      complianceStatus: 'APPROVED',
    });
  });

  it('permits a restricted teacher only inside the granted scope', async () => {
    const { profile, teacher } = await newTeacherProvider(context);
    await context.service.restrict(teacher.id, {
      actorUserId: ADMIN,
      reasonCode: 'SCOPE_LIMITED',
      requestId: REQUEST_ID,
      restriction: { allowedSubjectCodes: ['MATH'], allowedCityCodes: ['BEIJING'] },
    });

    await expect(
      context.service.assertOrderable(profile.id, 'TEACHER', {
        subjectCodes: ['MATH'],
        cityCode: 'BEIJING',
      }),
    ).resolves.toBeDefined();

    await expect(
      context.service.assertOrderable(profile.id, 'TEACHER', {
        subjectCodes: ['PHYSICS'],
        cityCode: 'BEIJING',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      context.service.assertOrderable(profile.id, 'TEACHER', {
        subjectCodes: ['MATH'],
        cityCode: 'SHANGHAI',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('never blocks a capability that needs no compliance', async () => {
    const { profile } = await newTeacherProvider(context);

    await expect(
      context.service.assertOrderable(profile.id, 'GRADUATE_TUTOR'),
    ).resolves.toMatchObject({ complianceStatus: 'NOT_REQUIRED' });
  });

  it('returns NOT_FOUND when the provider has no such capability', async () => {
    const { profile } = await newTeacherProvider(context);

    await expect(context.service.assertOrderable(profile.id, 'PHD_TUTOR')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

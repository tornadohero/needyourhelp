/**
 * Demo data for looking at the product (T036 之后的本地演示用).
 *
 * `pnpm seed:demo` — writes a small, consistent marketplace into the **dev**
 * database so the mini program has something to show: two approved and verified
 * mentors, published services, free slots, and one completed order with reviews.
 *
 * Why a separate script instead of the base seed:
 *
 * - the base seed (`prisma/seed-data.ts`) is part of the CI gate and of the
 *   integration tests; demo rows must never become an assertion;
 * - demo data has to respect what the server would have done: a mentor is only
 *   `searchable` because they are approved **and** verified, and a service is
 *   only visible because it is `PUBLISHED`. Nothing here fakes a state the
 *   platform would refuse.
 *
 * It is idempotent: a mentor is keyed by `(userId, publicName)`, so running it
 * twice changes nothing.
 */
import { PrismaClient } from '@prisma/client';

const DEMO_PREFIX = 'demo-';

interface DemoService {
  title: string;
  description: string;
  durationMinutes: number;
  /** Yuan, converted to minor units here — money is never a float on the wire. */
  priceYuan: number;
  subjects: string[];
  grades?: string[];
  skills?: string[];
}

interface DemoMentor {
  seedKey: string;
  publicName: string;
  headline: string;
  bio: string;
  cityCode: string;
  ratingAvg: string;
  ratingCount: number;
  completedOrderCount: number;
  services: DemoService[];
  /** How many free slots to publish, starting tomorrow. */
  slots: number;
}

const MENTORS: readonly DemoMentor[] = [
  {
    seedKey: `${DEMO_PREFIX}mentor-li`,
    publicName: '李老师',
    headline: '初中数学 · 八年一线教学',
    bio: '专注初中数学体系搭建，擅长把薄弱章节补成优势。',
    cityCode: 'BEIJING',
    ratingAvg: '4.80',
    ratingCount: 26,
    completedOrderCount: 31,
    slots: 4,
    services: [
      {
        title: '初中数学一对一',
        description: '按章节诊断，先补基础再练综合题。',
        durationMinutes: 60,
        priceYuan: 200,
        subjects: ['MATH'],
        grades: ['JUNIOR_1', 'JUNIOR_2', 'JUNIOR_3'],
        skills: ['HOMEWORK_SUPPORT', 'EXAM_PREP'],
      },
      {
        title: '中考数学冲刺',
        description: '真题拆解与限时训练，适合初三下学期。',
        durationMinutes: 90,
        priceYuan: 320,
        subjects: ['MATH'],
        grades: ['JUNIOR_3'],
        skills: ['EXAM_PREP', 'STUDY_PLANNING'],
      },
    ],
  },
  {
    seedKey: `${DEMO_PREFIX}mentor-wang`,
    publicName: '王老师',
    headline: '高中英语 · 口语与写作',
    bio: '英语专业八级，带过六届高三，写作提分明显。',
    cityCode: 'SHANGHAI',
    ratingAvg: '4.60',
    ratingCount: 14,
    completedOrderCount: 18,
    slots: 3,
    services: [
      {
        title: '高中英语写作精批',
        description: '逐句批改 + 范文拆解，两周见效。',
        durationMinutes: 60,
        priceYuan: 260,
        subjects: ['ENGLISH'],
        grades: ['SENIOR_1', 'SENIOR_2', 'SENIOR_3'],
        skills: ['SPEAKING_PRACTICE', 'EXAM_PREP'],
      },
    ],
  },
];

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60_000);
}

async function main(): Promise<void> {
  const client = new PrismaClient();
  try {
    const terms = await client.taxonomyTerm.findMany({ where: { active: true } });
    const termId = (type: string, code: string): string | null =>
      terms.find((term) => term.type === type && term.code === code)?.id ?? null;

    // The seeded parent plays the customer in the demo order below.
    const buyer = await client.user.findFirst({
      where: { roles: { some: { role: 'PARENT' } } },
    });
    if (buyer === null) {
      throw new Error('run `pnpm prisma:seed` first: the demo needs the seeded parent account.');
    }

    let createdProviders = 0;
    let createdServices = 0;
    let createdSlots = 0;
    let createdOrders = 0;
    let createdReviews = 0;

    for (const mentor of MENTORS) {
      // A seeded account is identified by a deterministic openid hash, the same
      // way the base seed does it: no email, no phone, no PII.
      const openidHash = `demo:${mentor.seedKey}`;
      const existingUser = await client.user.findUnique({
        where: { wechatOpenidHash: openidHash },
      });
      const user =
        existingUser ??
        (await client.user.create({
          data: { wechatOpenidHash: openidHash, displayName: mentor.publicName, status: 'ACTIVE' },
        }));

      for (const role of ['USER', 'PROVIDER'] as const) {
        await client.userRole.upsert({
          where: { userId_role: { userId: user.id, role } },
          create: { userId: user.id, role },
          update: {},
        });
      }

      const existing = await client.providerProfile.findFirst({
        where: { userId: user.id, publicName: mentor.publicName },
      });
      if (existing !== null) {
        continue;
      }

      const provider = await client.providerProfile.create({
        data: {
          userId: user.id,
          providerType: 'TUTORING',
          publicName: mentor.publicName,
          headline: mentor.headline,
          bio: mentor.bio,
          cityCode: mentor.cityCode,
          serviceMode: 'ONLINE',
          avatarVisibility: 'PRIVATE',
          // Approved **and** verified: that is the only reason `searchable` is
          // true, and it is what makes the mentor appear in discovery.
          approvalStatus: 'APPROVED',
          searchable: true,
          ratingAvg: mentor.ratingAvg,
          ratingCount: mentor.ratingCount,
          completedOrderCount: mentor.completedOrderCount,
        },
      });
      createdProviders += 1;

      await client.providerCapability.create({
        data: {
          providerId: provider.id,
          capabilityType: 'STUDENT_TUTOR',
          status: 'APPROVED',
          verificationLevel: 'FULL',
          complianceStatus: 'NOT_REQUIRED',
        },
      });

      // Identity and education: the two cases discovery and trust depend on.
      for (const verificationType of ['IDENTITY', 'EDUCATION'] as const) {
        await client.verificationCase.create({
          data: {
            providerId: provider.id,
            verificationType,
            status: 'APPROVED',
            submittedAt: hoursFromNow(-48),
            reviewedAt: hoursFromNow(-24),
            decisionReason: 'DOCUMENTS_VERIFIED',
          },
        });
      }

      for (const service of mentor.services) {
        const created = await client.service.create({
          data: {
            providerId: provider.id,
            domain: 'TUTORING',
            title: service.title,
            description: service.description,
            durationMinutes: service.durationMinutes,
            priceMinor: service.priceYuan * 100,
            currency: 'CNY',
            deliveryMode: 'ONLINE',
            status: 'PUBLISHED',
          },
        });
        createdServices += 1;

        const links = [
          ...service.subjects.map((code) => termId('SUBJECT', code)),
          ...(service.grades ?? []).map((code) => termId('GRADE', code)),
          ...(service.skills ?? []).map((code) => termId('SKILL', code)),
        ].filter((id): id is string => id !== null);

        for (const id of links) {
          await client.serviceTerm.create({ data: { serviceId: created.id, termId: id } });
        }
      }

      for (let index = 0; index < mentor.slots; index += 1) {
        const start = hoursFromNow(24 + index * 26);
        await client.availabilitySlot.create({
          data: {
            providerId: provider.id,
            startAt: start,
            endAt: new Date(start.getTime() + 60 * 60_000),
            status: 'OPEN',
          },
        });
        createdSlots += 1;
      }
    }

    // Two finished orders, one review each: a review is unique per
    // (order, reviewer, reviewee), which is exactly the platform's rule — one
    // review per participant per order.
    const firstProvider = await client.providerProfile.findFirst({
      where: { publicName: '李老师', searchable: true },
      include: { services: true },
    });
    const service = firstProvider?.services[0];

    if (firstProvider !== null && service !== undefined) {
      const reviews = [
        { orderNo: `MP${Date.now()}0001`, rating: 5, content: '讲得很清楚，孩子第一次说听懂了。' },
        { orderNo: `MP${Date.now()}0002`, rating: 5, content: '会留作业并逐题批改，很负责。' },
      ];

      for (const [index, review] of reviews.entries()) {
        const existingOrder = await client.order.findUnique({
          where: { orderNo: review.orderNo },
        });
        if (existingOrder !== null) {
          continue;
        }

        const scheduledStart = hoursFromNow(-72 - index * 48);
        const order = await client.order.create({
          data: {
            orderNo: review.orderNo,
            buyerUserId: buyer.id,
            providerId: firstProvider.id,
            serviceId: service.id,
            domain: 'TUTORING',
            status: 'COMPLETED',
            amountMinor: service.priceMinor,
            platformFeeMinor: Math.round(service.priceMinor * 0.1),
            providerAmountMinor: service.priceMinor - Math.round(service.priceMinor * 0.1),
            currency: 'CNY',
            scheduledStart,
            scheduledEnd: new Date(scheduledStart.getTime() + 60 * 60_000),
            priceSnapshot: {
              serviceId: service.id,
              title: service.title,
              priceMinor: service.priceMinor,
              currency: 'CNY',
              durationMinutes: service.durationMinutes,
            },
            policySnapshot: {},
          },
        });
        createdOrders += 1;

        await client.review.create({
          data: {
            orderId: order.id,
            reviewerUserId: buyer.id,
            revieweeUserId: firstProvider.userId,
            rating: review.rating,
            content: review.content,
            status: 'PUBLISHED',
          },
        });
        createdReviews += 1;
      }
    }

    console.info(
      `[seed:demo] providers=${createdProviders} services=${createdServices} slots=${createdSlots} orders=${createdOrders} reviews=${createdReviews}` +
        (createdProviders === 0 ? ' (already seeded — nothing to do)' : ''),
    );
  } finally {
    await client.$disconnect();
  }
}

void main();

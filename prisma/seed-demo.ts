/**
 * Demo data for looking at the product.
 *
 * `pnpm seed:demo` — writes a small, consistent marketplace into the **dev**
 * database so every screen has something to show:
 *
 * - the marketplace: two approved and verified mentors, published services,
 *   free slots, and finished orders with reviews (发现 / 导师详情 / 预约);
 * - a personal side for every account a real mini program login created:
 *   parent profile, two children, consents, orders in every status the state
 *   machine has, payments and refunds (我的 / 订单 / 订单详情 / 支付);
 * - a mentor profile for those accounts too, with services, slots and orders to
 *   deliver (我的 → 导师工作台 / 服务管理 / 可预约时段 / 我的接单).
 *
 * Why a separate script instead of the base seed:
 *
 * - the base seed (`prisma/seed-data.ts`) is part of the CI gate and of the
 *   integration tests; demo rows must never become an assertion;
 * - demo data has to respect what the server would have done: a mentor is only
 *   `searchable` because they are approved **and** verified, a service is only
 *   visible because it is `PUBLISHED`, and an order only carries the money the
 *   service says it costs. Nothing here fakes a state the platform would refuse.
 *
 * It is idempotent: a mentor is keyed by `(userId, publicName)` and a personal
 * side is only built for an account that has no order yet, so running it twice
 * changes nothing. Log in once, run it again, and the new account is filled too.
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

/**
 * The orders the parent side needs to see.
 *
 * One row per status the state machine has (`specs/06` §Order), so the list, the
 * money screen and the two commands — cancel and refund-request — can all be
 * looked at without driving the state machine by hand.
 */
const PARENT_ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'REFUND_PENDING',
  'REFUNDED',
  'CANCELLED',
] as const;

/** The orders the mentor side has to deliver, each with its own next command. */
const PROVIDER_ORDER_STATUSES = ['PAID', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] as const;

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60_000);
}

function moneySplit(priceMinor: number): { fee: number; providerAmount: number } {
  const fee = Math.round(priceMinor * 0.1);
  return { fee, providerAmount: priceMinor - fee };
}

async function main(): Promise<void> {
  const client = new PrismaClient();
  try {
    const terms = await client.taxonomyTerm.findMany({ where: { active: true } });
    const termId = (type: string, code: string): string | null =>
      terms.find((term) => term.type === type && term.code === code)?.id ?? null;

    // The seeded parent plays the customer in the mentor's delivery orders.
    const buyer = await client.user.findFirst({
      where: { roles: { some: { role: 'PARENT' } } },
    });
    if (buyer === null) {
      throw new Error('run `pnpm prisma:seed` first: the demo needs the seeded parent account.');
    }

    let providers = 0;
    let services = 0;
    let slots = 0;
    let orders = 0;
    let reviews = 0;
    let filledAccounts = 0;

    // -----------------------------------------------------------------------
    // 1. The marketplace: mentors, services, free slots, finished orders.
    // -----------------------------------------------------------------------
    for (const mentor of MENTORS) {
      await ensureMentor(client, mentor, termId, (counts) => {
        providers += counts.providers;
        services += counts.services;
        slots += counts.slots;
      });
    }

    const firstProvider = await client.providerProfile.findFirst({
      where: { publicName: '李老师', searchable: true },
      include: { services: true, user: true },
    });
    const service = firstProvider?.services[0];

    if (firstProvider !== null && service !== undefined) {
      const reviews$ = [
        { orderNo: `MP${Date.now()}0001`, rating: 5, content: '讲得很清楚，孩子第一次说听懂了。' },
        { orderNo: `MP${Date.now()}0002`, rating: 5, content: '会留作业并逐题批改，很负责。' },
      ];

      for (const [index, review] of reviews$.entries()) {
        const existing = await client.order.findUnique({ where: { orderNo: review.orderNo } });
        if (existing !== null) {
          continue;
        }

        const order = await client.order.create({
          data: {
            orderNo: review.orderNo,
            buyerUserId: buyer.id,
            providerId: firstProvider.id,
            serviceId: service.id,
            domain: 'TUTORING',
            status: 'COMPLETED',
            ...moneyFields(service.priceMinor),
            currency: 'CNY',
            scheduledStart: hoursFromNow(-72 - index * 48),
            scheduledEnd: hoursFromNow(-71 - index * 48),
            priceSnapshot: snapshot(service),
            policySnapshot: {},
          },
        });
        orders += 1;

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
        reviews += 1;
      }
    }

    // -----------------------------------------------------------------------
    // 2. The personal side, for every account a real login created.
    // -----------------------------------------------------------------------
    const accounts = await client.user.findMany({
      where: {
        displayName: { startsWith: '微信用户' },
        NOT: { wechatOpenidHash: { startsWith: 'demo:' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const counterpart = firstProvider ?? (await client.providerProfile.findFirst());

    for (const account of accounts) {
      const existing = await client.order.count({ where: { buyerUserId: account.id } });
      if (existing > 0) {
        continue;
      }

      const counts = await fillPersonalSide(client, account.id, counterpart, service, buyer.id);
      orders += counts.orders;
      reviews += counts.reviews;
      slots += counts.slots;
      services += counts.services;
      providers += counts.providers;
      filledAccounts += 1;
    }

    console.info(
      `[seed:demo] providers=${providers} services=${services} slots=${slots} orders=${orders} ` +
        `reviews=${reviews} accountsFilled=${filledAccounts}` +
        (providers === 0 && filledAccounts === 0 ? ' (already seeded — nothing to do)' : ''),
    );
    if (accounts.length === 0) {
      console.info(
        '[seed:demo] no mini program account yet: open the mini program once (it logs in), then run this again.',
      );
    }
  } finally {
    await client.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function moneyFields(priceMinor: number): {
  amountMinor: number;
  platformFeeMinor: number;
  providerAmountMinor: number;
} {
  const { fee, providerAmount } = moneySplit(priceMinor);
  return { amountMinor: priceMinor, platformFeeMinor: fee, providerAmountMinor: providerAmount };
}

function snapshot(service: {
  id: string;
  title: string;
  priceMinor: number;
  durationMinutes: number;
}): {
  serviceId: string;
  title: string;
  priceMinor: number;
  currency: string;
  durationMinutes: number;
} {
  return {
    serviceId: service.id,
    title: service.title,
    priceMinor: service.priceMinor,
    currency: 'CNY',
    durationMinutes: service.durationMinutes,
  };
}

/**
 * Publish a slot the server would accept.
 *
 * The database has an exclusion constraint (`availability_slots_no_overlap`,
 * T011 owns that invariant), so a demo slot is pushed forward until it fits
 * instead of being written with a raw SQL that dodges the rule.
 */
async function createSlot(
  client: PrismaClient,
  providerId: string,
  startAt: Date,
  durationMinutes: number,
  status: 'OPEN' | 'BOOKED',
): Promise<void> {
  const duration = durationMinutes * 60_000;
  let cursor = startAt.getTime();

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const end = new Date(cursor + duration);
    const clash = await client.availabilitySlot.findFirst({
      where: { providerId, startAt: { lt: end }, endAt: { gt: new Date(cursor) } },
    });
    if (clash === null) {
      break;
    }
    cursor += 3 * 60 * 60_000;
  }

  await client.availabilitySlot.create({
    data: { providerId, startAt: new Date(cursor), endAt: new Date(cursor + duration), status },
  });
}

type TermLookup = (type: string, code: string) => string | null;

async function ensureMentor(
  client: PrismaClient,
  mentor: DemoMentor,
  termId: TermLookup,
  report: (counts: { providers: number; services: number; slots: number }) => void,
): Promise<void> {
  // A seeded account is identified by a deterministic openid hash, the same way
  // the base seed does it: no email, no phone, no PII.
  const openidHash = `demo:${mentor.seedKey}`;
  const existingUser = await client.user.findUnique({ where: { wechatOpenidHash: openidHash } });
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

  if ((await client.providerProfile.findFirst({ where: { userId: user.id } })) !== null) {
    return;
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
      // Approved **and** verified: that is the only reason `searchable` is true,
      // and it is what makes the mentor appear in discovery.
      approvalStatus: 'APPROVED',
      searchable: true,
      ratingAvg: mentor.ratingAvg,
      ratingCount: mentor.ratingCount,
      completedOrderCount: mentor.completedOrderCount,
    },
  });

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

  let createdServices = 0;
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
    await createSlot(client, provider.id, hoursFromNow(24 + index * 26), 60, 'OPEN');
  }

  report({ providers: 1, services: createdServices, slots: mentor.slots });
}

type DemoServiceRow = {
  id: string;
  title: string;
  priceMinor: number;
  durationMinutes: number;
};

/** Everything one account needs on the buyer side, and on the mentor side. */
async function fillPersonalSide(
  client: PrismaClient,
  userId: string,
  counterpart: { id: string; userId: string } | null,
  service: DemoServiceRow | undefined,
  counterpartBuyerId: string,
): Promise<{
  orders: number;
  reviews: number;
  slots: number;
  services: number;
  providers: number;
}> {
  let orders = 0;
  let reviews = 0;
  let slots = 0;
  let services = 0;
  let providers = 0;

  // Roles and profile: a parent can book, and a mentor can deliver.
  for (const role of ['USER', 'PARENT', 'PROVIDER'] as const) {
    await client.userRole.upsert({
      where: { userId_role: { userId, role } },
      create: { userId, role },
      update: {},
    });
  }

  await client.parentProfile.upsert({
    where: { userId },
    create: { userId, displayName: '演示家长', cityCode: 'SHANGHAI' },
    update: {},
  });

  // Two children: one consented (bookable), one still pending (not bookable).
  const children = [
    {
      nickname: '小明',
      birthYear: 2014,
      gradeCode: 'JUNIOR_2',
      schoolName: null,
      learningGoals: '数学基础',
      consent: 'GRANTED' as const,
    },
    {
      nickname: '小红',
      birthYear: 2016,
      gradeCode: 'PRIMARY_5',
      schoolName: null,
      learningGoals: null,
      consent: 'PENDING' as const,
    },
  ];
  let childId: string | null = null;
  for (const child of children) {
    const existing = await client.childProfile.findFirst({
      where: { guardianUserId: userId, nickname: child.nickname },
    });
    const row =
      existing ??
      (await client.childProfile.create({
        data: {
          guardianUserId: userId,
          nickname: child.nickname,
          birthYear: child.birthYear,
          gradeCode: child.gradeCode,
          schoolName: child.schoolName,
          learningGoals: child.learningGoals,
          dataProcessingConsentStatus: child.consent,
        },
      }));
    childId = childId ?? row.id;
  }

  // Consents: granted, granted, and one granted then revoked — the three states
  // a consent row can be in (`specs/10`).
  const consents = [
    { consentType: 'TERMS' as const, granted: true, revoked: false },
    { consentType: 'PRIVACY' as const, granted: true, revoked: false },
    { consentType: 'MINOR_GUARDIAN' as const, granted: true, revoked: false },
    { consentType: 'MARKETING' as const, granted: true, revoked: true },
  ];
  for (const consent of consents) {
    const existing = await client.consent.findFirst({
      where: { userId, consentType: consent.consentType },
    });
    if (existing !== null) {
      continue;
    }
    await client.consent.create({
      data: {
        userId,
        consentType: consent.consentType,
        policyVersion: '2026-10-01',
        granted: consent.granted,
        grantedAt: hoursFromNow(-24),
        revokedAt: consent.revoked ? hoursFromNow(-2) : null,
      },
    });
  }

  if (counterpart === null || service === undefined) {
    return { orders, reviews, slots, services, providers };
  }

  // Buyer side: one order per status, each with the payment (and the refund)
  // that status implies.
  for (const [index, status] of PARENT_ORDER_STATUSES.entries()) {
    const start = hoursFromNow(24 + index * 30);
    const cancelled = status === 'CANCELLED';

    await createSlot(
      client,
      counterpart.id,
      start,
      service.durationMinutes,
      cancelled ? 'OPEN' : 'BOOKED',
    );
    slots += 1;

    const order = await client.order.create({
      data: {
        orderNo: `MP${Date.now()}${String(1000 + index)}`,
        buyerUserId: userId,
        providerId: counterpart.id,
        serviceId: service.id,
        childId: childId,
        domain: 'TUTORING',
        status,
        ...moneyFields(service.priceMinor),
        currency: 'CNY',
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + service.durationMinutes * 60_000),
        priceSnapshot: snapshot(service),
        policySnapshot: {},
      },
    });
    orders += 1;

    if (status !== 'PENDING_PAYMENT' && status !== 'CANCELLED') {
      const payment = await client.payment.create({
        data: {
          orderId: order.id,
          provider: 'MOCK',
          providerTransactionId: `demo-pay-${order.id}`,
          status: 'SUCCEEDED',
          amountMinor: service.priceMinor,
          paidAt: hoursFromNow(-1),
        },
      });

      if (status === 'REFUND_PENDING') {
        await client.refund.create({
          data: {
            orderId: order.id,
            paymentId: payment.id,
            amountMinor: service.priceMinor,
            reason: '时间安排冲突',
            status: 'REQUESTED',
          },
        });
      }

      if (status === 'REFUNDED') {
        await client.refund.create({
          data: {
            orderId: order.id,
            paymentId: payment.id,
            amountMinor: service.priceMinor,
            reason: '课程未开始',
            status: 'SUCCEEDED',
            providerRef: `demo-refund-${order.id}`,
          },
        });
      }
    }

    // A finished order is reviewable — one review per order, per platform rule.
    if (status === 'COMPLETED') {
      await client.review.create({
        data: {
          orderId: order.id,
          reviewerUserId: userId,
          revieweeUserId: counterpart.userId,
          rating: 5,
          content: '按孩子的情况调整了节奏，很耐心。',
          status: 'PUBLISHED',
        },
      });
      reviews += 1;
    }
  }

  // Mentor side: this account delivers too, so the desk has services, slots and
  // orders whose next command is accept / start / finish.
  const desk = await client.providerProfile.findFirst({ where: { userId } });
  if (desk === null) {
    const created = await client.providerProfile.create({
      data: {
        userId,
        providerType: 'TUTORING',
        publicName: '演示导师（我的档案）',
        headline: '用于调试导师工作台',
        bio: '演示数据：可发布服务、加时段、接单与交付。',
        cityCode: 'SHANGHAI',
        serviceMode: 'ONLINE',
        avatarVisibility: 'PRIVATE',
        approvalStatus: 'APPROVED',
        searchable: true,
        ratingAvg: '4.90',
        ratingCount: 3,
        completedOrderCount: 1,
      },
    });
    providers += 1;

    await client.providerCapability.create({
      data: {
        providerId: created.id,
        capabilityType: 'STUDENT_TUTOR',
        status: 'APPROVED',
        verificationLevel: 'FULL',
        complianceStatus: 'NOT_REQUIRED',
      },
    });
    for (const verificationType of ['IDENTITY', 'EDUCATION'] as const) {
      await client.verificationCase.create({
        data: {
          providerId: created.id,
          verificationType,
          status: 'APPROVED',
          submittedAt: hoursFromNow(-48),
          reviewedAt: hoursFromNow(-24),
          decisionReason: 'DOCUMENTS_VERIFIED',
        },
      });
    }

    const deskService = await client.service.create({
      data: {
        providerId: created.id,
        domain: 'TUTORING',
        title: '演示服务 · 一对一答疑',
        description: '演示数据：用于走通发布、下架与下单。',
        durationMinutes: 60,
        priceMinor: 15_000,
        currency: 'CNY',
        deliveryMode: 'ONLINE',
        status: 'PUBLISHED',
      },
    });
    services += 1;

    for (let index = 0; index < 3; index += 1) {
      await createSlot(client, created.id, hoursFromNow(30 + index * 26), 60, 'OPEN');
      slots += 1;
    }

    for (const [index, status] of PROVIDER_ORDER_STATUSES.entries()) {
      const start = hoursFromNow(20 + index * 30);
      await createSlot(client, created.id, start, deskService.durationMinutes, 'BOOKED');
      slots += 1;

      const order = await client.order.create({
        data: {
          orderNo: `MP${Date.now()}${String(3000 + index)}`,
          buyerUserId: counterpartBuyerId,
          providerId: created.id,
          serviceId: deskService.id,
          domain: 'TUTORING',
          status,
          ...moneyFields(deskService.priceMinor),
          currency: 'CNY',
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + deskService.durationMinutes * 60_000),
          priceSnapshot: snapshot(deskService),
          policySnapshot: {},
        },
      });
      orders += 1;

      if (status !== 'PENDING_PAYMENT') {
        await client.payment.create({
          data: {
            orderId: order.id,
            provider: 'MOCK',
            providerTransactionId: `demo-pay-desk-${order.id}`,
            status: 'SUCCEEDED',
            amountMinor: deskService.priceMinor,
            paidAt: hoursFromNow(-1),
          },
        });
      }
    }
  }

  // One conversation, so the message side has history when its screen lands
  // (IM is not built yet: the messages tab is still a shell).
  const conversation = await client.conversation.create({
    data: { domain: 'TUTORING', status: 'OPEN' },
  });
  for (const [memberId, role] of [
    [userId, 'BUYER'],
    [counterpart.userId, 'PROVIDER'],
  ] as const) {
    await client.conversationMember.create({
      data: { conversationId: conversation.id, userId: memberId, role },
    });
  }
  const lines = ['老师好，这次想补一下函数。', '好的，先做一份诊断。', '那我把最近的卷子发您。'];
  for (const [index] of lines.entries()) {
    await client.messageReference.create({
      data: {
        conversationId: conversation.id,
        externalMessageId: `demo-msg-${conversation.id}-${index}`,
        senderUserId: (index + 1) % 2 === 0 ? userId : counterpart.userId,
        messageType: 'TEXT',
        moderationStatus: 'APPROVED',
      },
    });
  }

  return { orders, reviews, slots, services, providers };
}

void main();

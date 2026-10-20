import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { API_BASE } from '@mentor/api-contracts';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { ACCESS_TOKEN_SERVICE } from '../../src/modules/auth/domain/access-token.service';
import { AUTH_CONFIG, AUTH_SERVICE, AuthService } from '../../src/modules/auth/domain/auth.service';
import { CONSOLE_CREDENTIAL_REPOSITORY } from '../../src/modules/auth/domain/console-credential.repository';
import {
  CONSOLE_PASSWORD_HASHER,
  ScryptPasswordHasher,
} from '../../src/modules/auth/domain/password-hasher';
import { PrismaConsoleCredentialRepository } from '../../src/modules/auth/infrastructure/prisma-console-credential.repository';
import { SESSION_REPOSITORY } from '../../src/modules/auth/domain/session.repository';
import { WECHAT_AUTH_PROVIDER } from '../../src/modules/auth/domain/wechat-auth.provider';
import { AuthController } from '../../src/modules/auth/http/auth.controller';
import { JwtAuthGuard } from '../../src/modules/auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/http/guards/roles.guard';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { PrismaSessionRepository } from '../../src/modules/auth/infrastructure/prisma-session.repository';
import { AUDIT_LOG_REPOSITORY } from '../../src/modules/audit/domain/audit-log.repository';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/prisma-audit-log.repository';
import { TeacherComplianceService } from '../../src/modules/compliance/application/teacher-compliance.service';
import { AdminComplianceController } from '../../src/modules/compliance/http/admin-compliance.controller';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { FEATURE_FLAG_REPOSITORY } from '../../src/modules/platform/domain/feature-flag.repository';
import { PrismaFeatureFlagRepository } from '../../src/modules/platform/infrastructure/prisma-feature-flag.repository';
import { ComposedProviderReadinessGates } from '../../src/modules/provider/application/composed-provider-readiness.gates';
import { PrismaServiceReadiness } from '../../src/modules/services/infrastructure/prisma-service.readiness';
import { ProviderApplicationService } from '../../src/modules/provider/application/provider-application.service';
import { PROVIDER_CAPABILITY_REPOSITORY } from '../../src/modules/provider/domain/provider-capability.repository';
import { PROVIDER_PROFILE_REPOSITORY } from '../../src/modules/provider/domain/provider-profile.repository';
import {
  PROVIDER_READINESS_GATES,
  SERVICE_READINESS,
  VERIFICATION_READINESS,
} from '../../src/modules/provider/domain/provider-readiness.gates';
import { ProviderController } from '../../src/modules/provider/http/provider.controller';
import { PrismaProviderCapabilityRepository } from '../../src/modules/provider/infrastructure/prisma-provider-capability.repository';
import { PrismaProviderProfileRepository } from '../../src/modules/provider/infrastructure/prisma-provider-profile.repository';
import { VerificationAdminService } from '../../src/modules/verification/application/verification-admin.service';
import { VerificationService } from '../../src/modules/verification/application/verification.service';
import { DOCUMENT_METADATA_CIPHER } from '../../src/modules/verification/domain/document-metadata-cipher';
import { OBJECT_STORAGE_GATEWAY } from '../../src/modules/verification/domain/object-storage.gateway';
import { VERIFICATION_CASE_REPOSITORY } from '../../src/modules/verification/domain/verification-case.repository';
import { VERIFICATION_DOCUMENT_MAX_BYTES } from '../../src/modules/verification/domain/verification-document-policy';
import { AdminVerificationController } from '../../src/modules/verification/http/admin-verification.controller';
import { VerificationController } from '../../src/modules/verification/http/verification.controller';
import {
  AesGcmDocumentMetadataCipher,
  DOCUMENT_METADATA_KEY,
} from '../../src/modules/verification/infrastructure/aes-gcm-document-metadata.cipher';
import { MockObjectStorageGateway } from '../../src/modules/verification/infrastructure/mock-object-storage.gateway';
import { PrismaVerificationCaseRepository } from '../../src/modules/verification/infrastructure/prisma-verification-case.repository';
import { PrismaVerificationReadiness } from '../../src/modules/verification/infrastructure/prisma-verification-readiness';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T007 compliance endpoints and the orderability gate
 * (`specs/06-verification-state-machine.md` §Teacher compliance,
 * `specs/14-test-strategy.md` §API tests and E2E-03):
 *
 * - authenticated success, unauthenticated failure, wrong-role failure,
 *   invalid input, unknown target;
 * - a teacher with pending compliance cannot be ordered, and identity approval
 *   is not sufficient;
 * - an approved teacher is orderable; a restricted teacher only inside the
 *   granted scope;
 * - every compliance decision is audited.
 */
describeWithDatabase('compliance HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  let compliance: TeacherComplianceService;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [
        AuthController,
        ProviderController,
        VerificationController,
        AdminVerificationController,
        AdminComplianceController,
      ],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: CONSOLE_CREDENTIAL_REPOSITORY, useClass: PrismaConsoleCredentialRepository },
        { provide: CONSOLE_PASSWORD_HASHER, useClass: ScryptPasswordHasher },
        { provide: AUTH_SERVICE, useExisting: AuthService },
        JwtAuthGuard,
        RolesGuard,
        ProviderApplicationService,
        VerificationService,
        VerificationAdminService,
        TeacherComplianceService,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
        { provide: FEATURE_FLAG_REPOSITORY, useClass: PrismaFeatureFlagRepository },
        { provide: PROVIDER_PROFILE_REPOSITORY, useClass: PrismaProviderProfileRepository },
        { provide: PROVIDER_CAPABILITY_REPOSITORY, useClass: PrismaProviderCapabilityRepository },
        { provide: VERIFICATION_CASE_REPOSITORY, useClass: PrismaVerificationCaseRepository },
        { provide: VERIFICATION_READINESS, useClass: PrismaVerificationReadiness },
        { provide: SERVICE_READINESS, useClass: PrismaServiceReadiness },
        { provide: PROVIDER_READINESS_GATES, useClass: ComposedProviderReadinessGates },
        { provide: DOCUMENT_METADATA_CIPHER, useClass: AesGcmDocumentMetadataCipher },
        {
          provide: DOCUMENT_METADATA_KEY,
          useValue: Buffer.from('t007-integration-metadata-key-0123456789abcdef0'.slice(0, 32)),
        },
        {
          provide: OBJECT_STORAGE_GATEWAY,
          useValue: new MockObjectStorageGateway({
            environment: 'test',
            signingSecret: 't007-integration-secret',
            baseUrl: 'https://storage.test/objects',
            uploadUrlTtlSeconds: 900,
            downloadUrlTtlSeconds: 300,
          }),
        },
        { provide: VERIFICATION_DOCUMENT_MAX_BYTES, useValue: 10 * 1024 * 1024 },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: 'compliance-e2e-secret',
            ttlSeconds: 900,
            issuer: 'mentor-platform',
          }),
        },
        {
          provide: WECHAT_AUTH_PROVIDER,
          useValue: new MockWeChatAuthProvider({ environment: 'test' }),
        },
        {
          provide: AUTH_CONFIG,
          useValue: {
            accessTokenTtlSeconds: 900,
            refreshTokenTtlSeconds: 86_400,
            openidPepper: 'compliance-e2e-pepper',
            defaultRoles: ['USER'],
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_BASE.replace(/^\/+/, ''));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0);

    compliance = app.get(TeacherComplianceService);

    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${API_BASE}`;
  });

  afterAll(async () => {
    await app?.close();
    await prisma.verificationDocument.deleteMany({
      where: { verificationCase: { provider: { userId: { in: userIds } } } },
    });
    await prisma.verificationCase.deleteMany({
      where: { provider: { userId: { in: userIds } } },
    });
    await prisma.providerCapability.deleteMany({
      where: { provider: { userId: { in: userIds } } },
    });
    await prisma.providerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface ErrorBody {
    error: { code: string; message: string };
  }

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: T; raw: string }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw) as T, raw };
  }

  async function login(): Promise<{ token: string; userId: string }> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t007-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  async function makeAdmin(userId: string): Promise<void> {
    await prisma.userRole.upsert({
      where: { userId_role: { userId, role: 'ADMIN' } },
      create: { userId, role: 'ADMIN' },
      update: {},
    });
  }

  interface ApplicationBody {
    data: {
      id: string;
      capabilities: {
        id: string;
        capabilityType: string;
        complianceStatus: string;
      }[];
    };
  }

  /** A teacher application: the teacher capability starts in compliance review. */
  async function loginAsTeacher(): Promise<{
    token: string;
    userId: string;
    providerId: string;
    capabilityId: string;
  }> {
    const account = await login();
    const created = await request<ApplicationBody>('POST', '/providers/applications', {
      token: account.token,
      body: {
        publicName: '王老师',
        cityCode: 'BEIJING',
        capabilityTypes: ['TEACHER'],
      },
    });
    expect(created.status).toBe(201);

    const capability = created.body.data.capabilities.find((c) => c.capabilityType === 'TEACHER');
    expect(capability?.complianceStatus).toBe('PENDING');

    return {
      token: account.token,
      userId: account.userId,
      providerId: created.body.data.id,
      capabilityId: capability?.id ?? '',
    };
  }

  const FILE_HASH = 'c'.repeat(64);
  const IDENTITY_DOCUMENT = {
    documentType: 'ID_CARD',
    contentType: 'image/jpeg',
    byteSize: 2048,
    fileHash: FILE_HASH,
  } as const;

  it('rejects unauthenticated compliance requests', async () => {
    const queue = await request<ErrorBody>('GET', '/admin/compliance');
    expect(queue.status).toBe(401);
    expect(queue.body.error.code).toBe('AUTH_REQUIRED');

    const approve = await request<ErrorBody>('POST', `/admin/compliance/${randomUUID()}/approve`, {
      body: { reasonCode: 'OK' },
    });
    expect(approve.status).toBe(401);
  });

  it('refuses compliance decisions without the admin role', async () => {
    const teacher = await loginAsTeacher();

    const queue = await request<ErrorBody>('GET', '/admin/compliance', { token: teacher.token });
    expect(queue.status).toBe(403);
    expect(queue.body.error.code).toBe('FORBIDDEN');

    const approve = await request<ErrorBody>(
      'POST',
      `/admin/compliance/${teacher.capabilityId}/approve`,
      { token: teacher.token, body: { reasonCode: 'OK' } },
    );
    expect(approve.status).toBe(403);
  });

  it('lists the compliance queue for an admin', async () => {
    const teacher = await loginAsTeacher();
    const admin = await login();
    await makeAdmin(admin.userId);

    const queue = await request<{
      data: { items: { capabilityId: string; providerName: string; complianceStatus: string }[] };
    }>('GET', '/admin/compliance', { token: admin.token });

    expect(queue.status).toBe(200);
    const item = queue.body.data.items.find((row) => row.capabilityId === teacher.capabilityId);
    expect(item?.complianceStatus).toBe('PENDING');
    expect(item?.providerName).toBe('王老师');
  });

  it('rejects invalid compliance input', async () => {
    const teacher = await loginAsTeacher();
    const admin = await login();
    await makeAdmin(admin.userId);
    const path = `/admin/compliance/${teacher.capabilityId}`;

    const withoutReason = await request<ErrorBody>('POST', `${path}/approve`, {
      token: admin.token,
      body: {},
    });
    expect(withoutReason.status).toBe(400);
    expect(withoutReason.body.error.code).toBe('VALIDATION_ERROR');

    const badRestriction = await request<ErrorBody>('POST', `${path}/restrict`, {
      token: admin.token,
      body: { reasonCode: 'SCOPE', restriction: {} },
    });
    expect(badRestriction.status).toBe(400);

    const badCode = await request<ErrorBody>('POST', `${path}/restrict`, {
      token: admin.token,
      body: { reasonCode: 'SCOPE', restriction: { allowedCityCodes: ['北京'] } },
    });
    expect(badCode.status).toBe(400);

    const extraField = await request<ErrorBody>('POST', `${path}/approve`, {
      token: admin.token,
      body: { reasonCode: 'OK', complianceStatus: 'APPROVED' },
    });
    expect(extraField.status).toBe(400);
    expect(extraField.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns NOT_FOUND for an unknown capability', async () => {
    const admin = await login();
    await makeAdmin(admin.userId);

    const response = await request<ErrorBody>('POST', `/admin/compliance/${randomUUID()}/approve`, {
      token: admin.token,
      body: { reasonCode: 'OK' },
    });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('audits a compliance approval', async () => {
    const teacher = await loginAsTeacher();
    const admin = await login();
    await makeAdmin(admin.userId);

    const approved = await request<{
      data: { capabilityId: string; complianceStatus: string; restriction: unknown };
    }>('POST', `/admin/compliance/${teacher.capabilityId}/approve`, {
      token: admin.token,
      body: { reasonCode: 'COMPLIANCE_VERIFIED', notes: '在职证明已核验' },
    });

    expect(approved.status).toBe(200);
    expect(approved.body.data.complianceStatus).toBe('APPROVED');
    expect(approved.body.data.restriction).toBeNull();

    const rows = await prisma.auditLog.findMany({
      where: { resourceType: 'provider_capability', resourceId: teacher.capabilityId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('COMPLIANCE_APPROVED');
    expect(rows[0]?.actorUserId).toBe(admin.userId);
    expect(rows[0]?.beforeJson).toMatchObject({ complianceStatus: 'PENDING' });
    expect(rows[0]?.afterJson).toMatchObject({
      complianceStatus: 'APPROVED',
      reasonCode: 'COMPLIANCE_VERIFIED',
      notes: '在职证明已核验',
    });
    expect(rows[0]?.requestId).toBeTruthy();
  });

  it('restricts a teacher to a configurable scope', async () => {
    const teacher = await loginAsTeacher();
    const admin = await login();
    await makeAdmin(admin.userId);

    const restricted = await request<{
      data: {
        complianceStatus: string;
        restriction: {
          allowedSubjectCodes: string[] | null;
          allowedCityCodes: string[] | null;
          allowedUntil: string | null;
        };
      };
    }>('POST', `/admin/compliance/${teacher.capabilityId}/restrict`, {
      token: admin.token,
      body: {
        reasonCode: 'SCOPE_LIMITED',
        restriction: { allowedSubjectCodes: ['MATH'], allowedCityCodes: ['BEIJING'] },
      },
    });

    expect(restricted.status).toBe(200);
    expect(restricted.body.data.complianceStatus).toBe('RESTRICTED');
    expect(restricted.body.data.restriction).toEqual({
      allowedSubjectCodes: ['MATH'],
      allowedCityCodes: ['BEIJING'],
      allowedUntil: null,
    });

    const row = await prisma.auditLog.findFirst({
      where: { resourceId: teacher.capabilityId, action: 'COMPLIANCE_RESTRICTED' },
    });
    expect(row?.afterJson).toMatchObject({
      restriction: { allowedSubjectCodes: ['MATH'], allowedCityCodes: ['BEIJING'] },
    });
  });

  it('E2E-03: a teacher is not orderable until compliance permits the service', async () => {
    const teacher = await loginAsTeacher();
    const admin = await login();
    await makeAdmin(admin.userId);

    // 1. Compliance pending: not orderable.
    await expect(compliance.assertOrderable(teacher.providerId, 'TEACHER')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    // 2. Identity approved: still not orderable (specs/06: identity is not
    //    sufficient).
    const created = await request<{ data: { id: string } }>('POST', '/verification/cases', {
      token: teacher.token,
      body: { verificationType: 'IDENTITY' },
    });
    expect(created.status).toBe(201);
    await request('POST', `/verification/cases/${created.body.data.id}/documents/upload-url`, {
      token: teacher.token,
      body: IDENTITY_DOCUMENT,
    });
    await request('POST', `/verification/cases/${created.body.data.id}/submit`, {
      token: teacher.token,
    });
    const identityApproved = await request<{ data: { status: string } }>(
      'POST',
      `/admin/verifications/${created.body.data.id}/approve`,
      { token: admin.token, body: { reasonCode: 'DOCUMENT_VERIFIED' } },
    );
    expect(identityApproved.body.data.status).toBe('APPROVED');

    const capability = await prisma.providerCapability.findUnique({
      where: { id: teacher.capabilityId },
    });
    expect(capability?.verificationLevel).toBe('IDENTITY');

    await expect(compliance.assertOrderable(teacher.providerId, 'TEACHER')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // 3. Compliance approved: orderable.
    await request('POST', `/admin/compliance/${teacher.capabilityId}/approve`, {
      token: admin.token,
      body: { reasonCode: 'COMPLIANCE_VERIFIED' },
    });
    await expect(compliance.assertOrderable(teacher.providerId, 'TEACHER')).resolves.toMatchObject({
      complianceStatus: 'APPROVED',
    });

    // 4. Restricted: only the permitted service.
    await request('POST', `/admin/compliance/${teacher.capabilityId}/restrict`, {
      token: admin.token,
      body: {
        reasonCode: 'SCOPE_LIMITED',
        restriction: { allowedSubjectCodes: ['MATH'] },
      },
    });

    await expect(
      compliance.assertOrderable(teacher.providerId, 'TEACHER', { subjectCodes: ['MATH'] }),
    ).resolves.toMatchObject({ complianceStatus: 'RESTRICTED' });

    await expect(
      compliance.assertOrderable(teacher.providerId, 'TEACHER', { subjectCodes: ['PHYSICS'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('never blocks a capability that needs no compliance', async () => {
    const account = await login();
    const created = await request<ApplicationBody>('POST', '/providers/applications', {
      token: account.token,
      body: { publicName: '张同学', capabilityTypes: ['GRADUATE_TUTOR'] },
    });
    expect(created.status).toBe(201);

    await expect(
      compliance.assertOrderable(created.body.data.id, 'GRADUATE_TUTOR'),
    ).resolves.toMatchObject({ complianceStatus: 'NOT_REQUIRED' });
  });
});

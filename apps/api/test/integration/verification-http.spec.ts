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
 * HTTP-level tests for the T006 endpoints (`specs/05-api-spec.md` §Verification
 * and §Admin; `specs/14-test-strategy.md` §API tests):
 *
 * - authenticated success, unauthenticated failure, wrong-role failure,
 *   invalid input;
 * - documents are private: no payload carries a storage key, a file hash or
 *   encrypted metadata, and access is a separate, audited admin action;
 * - admin approval and rejection are audited.
 */
describeWithDatabase('verification HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
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
          useValue: Buffer.from('t006-integration-metadata-key-0123456789abcdef0'.slice(0, 32)),
        },
        {
          provide: OBJECT_STORAGE_GATEWAY,
          useValue: new MockObjectStorageGateway({
            environment: 'test',
            signingSecret: 't006-integration-secret',
            baseUrl: 'https://storage.test/objects',
            uploadUrlTtlSeconds: 900,
            downloadUrlTtlSeconds: 300,
          }),
        },
        { provide: VERIFICATION_DOCUMENT_MAX_BYTES, useValue: 10 * 1024 * 1024 },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: 'verification-e2e-secret',
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
            openidPepper: 'verification-e2e-pepper',
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

  /** Register/login a fresh account through the real login endpoint. */
  async function login(): Promise<{ token: string; userId: string }> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t006-${randomUUID()}` } },
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

  /** Login + provider application, so a verification case can be created. */
  async function loginAsProvider(): Promise<{ token: string; userId: string }> {
    const account = await login();
    const created = await request<{ data: { id: string } }>('POST', '/providers/applications', {
      token: account.token,
      body: {
        publicName: '李老师',
        headline: '数学辅导',
        cityCode: 'BEIJING',
        capabilityTypes: ['STUDENT_TUTOR'],
      },
    });
    expect(created.status).toBe(201);
    return account;
  }

  interface CaseBody {
    data: {
      id: string;
      providerId: string;
      verificationType: string;
      status: string;
      decisionReason: string | null;
      documents: { id: string; documentType: string; createdAt: string }[];
    };
  }

  const FILE_HASH = 'b'.repeat(64);
  const IDENTITY_DOCUMENT = {
    documentType: 'ID_CARD',
    contentType: 'image/jpeg',
    byteSize: 4096,
    filename: 'id-card.jpg',
    fileHash: FILE_HASH,
  } as const;

  it('rejects unauthenticated verification requests', async () => {
    for (const path of ['/verification/me', '/admin/verifications']) {
      const response = await request<ErrorBody>('GET', path);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_REQUIRED');
    }

    const create = await request<ErrorBody>('POST', '/verification/cases', {
      body: { verificationType: 'IDENTITY' },
    });
    expect(create.status).toBe(401);

    const submit = await request<ErrorBody>('POST', `/verification/cases/${randomUUID()}/submit`);
    expect(submit.status).toBe(401);
  });

  it('requires a provider application before a case can be created', async () => {
    const { token } = await login();

    const response = await request<ErrorBody>('POST', '/verification/cases', {
      token,
      body: { verificationType: 'IDENTITY' },
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a draft case and lists it for its owner only', async () => {
    const provider = await loginAsProvider();
    const stranger = await loginAsProvider();

    const created = await request<CaseBody>('POST', '/verification/cases', {
      token: provider.token,
      body: { verificationType: 'IDENTITY' },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.documents).toHaveLength(0);

    const mine = await request<{ data: { providerId: string; cases: CaseBody['data'][] } }>(
      'GET',
      '/verification/me',
      { token: provider.token },
    );
    expect(mine.status).toBe(200);
    expect(mine.body.data.cases).toHaveLength(1);

    const theirs = await request<{ data: { providerId: string; cases: CaseBody['data'][] } }>(
      'GET',
      '/verification/me',
      { token: stranger.token },
    );
    expect(theirs.body.data.cases).toHaveLength(0);
    expect(theirs.body.data.providerId).not.toBe(mine.body.data.providerId);
  });

  it('rejects invalid case intake', async () => {
    const { token } = await loginAsProvider();

    const unknownType = await request<ErrorBody>('POST', '/verification/cases', {
      token,
      body: { verificationType: 'CRYSTAL_BALL' },
    });
    expect(unknownType.status).toBe(400);

    const selfStatus = await request<ErrorBody>('POST', '/verification/cases', {
      token,
      body: { verificationType: 'IDENTITY', status: 'APPROVED' },
    });
    expect(selfStatus.status).toBe(400);
    expect(selfStatus.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('never exposes document storage details in any payload', async () => {
    const { token } = await loginAsProvider();
    const created = await request<CaseBody>('POST', '/verification/cases', {
      token,
      body: { verificationType: 'IDENTITY' },
    });

    const upload = await request<{
      data: { documentId: string; uploadUrl: string; expiresAt: string; method: string };
    }>('POST', `/verification/cases/${created.body.data.id}/documents/upload-url`, {
      token,
      body: IDENTITY_DOCUMENT,
    });

    expect(upload.status).toBe(201);
    expect(upload.body.data.method).toBe('PUT');
    expect(upload.body.data.uploadUrl).toMatch(/signature=[0-9a-f]{64}/);
    const expiresIn = new Date(upload.body.data.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(0);
    expect(expiresIn).toBeLessThanOrEqual(900_000);

    const mine = await request<{ data: { cases: CaseBody['data'][] } }>('GET', '/verification/me', {
      token,
    });
    expect(mine.body.data.cases[0]?.documents).toHaveLength(1);

    // Privacy: the object key, the file hash and the encrypted metadata are
    // never serialized into case payloads (`specs/10-privacy-and-minors.md`).
    // The upload URL is the one exception by design: it is a signed URL for the
    // owner's own object, and it carries no metadata.
    expect(mine.raw).not.toContain('verification/');
    expect(mine.raw).not.toContain(FILE_HASH);
    expect(mine.raw).not.toContain('id-card.jpg');
    expect(mine.raw).not.toContain('encryptedMetadata');

    expect(upload.raw).not.toContain(FILE_HASH);
    expect(upload.raw).not.toContain('id-card.jpg');
    expect(upload.raw).not.toContain('encryptedMetadata');
  });

  it('refuses disallowed documents', async () => {
    const { token } = await loginAsProvider();
    const created = await request<CaseBody>('POST', '/verification/cases', {
      token,
      body: { verificationType: 'IDENTITY' },
    });
    const path = `/verification/cases/${created.body.data.id}/documents/upload-url`;

    const badType = await request<ErrorBody>('POST', path, {
      token,
      body: { ...IDENTITY_DOCUMENT, contentType: 'application/x-msdownload' },
    });
    expect(badType.status).toBe(400);

    const tooLarge = await request<ErrorBody>('POST', path, {
      token,
      body: { ...IDENTITY_DOCUMENT, byteSize: 10 * 1024 * 1024 + 1 },
    });
    expect(tooLarge.status).toBe(400);

    const badHash = await request<ErrorBody>('POST', path, {
      token,
      body: { ...IDENTITY_DOCUMENT, fileHash: 'nope' },
    });
    expect(badHash.status).toBe(400);

    const unknownDocumentType = await request<ErrorBody>('POST', path, {
      token,
      body: { ...IDENTITY_DOCUMENT, documentType: 'PASSPORT' },
    });
    expect(unknownDocumentType.status).toBe(400);
  });

  it('submits only with evidence and refuses a second submission', async () => {
    const { token } = await loginAsProvider();
    const created = await request<CaseBody>('POST', '/verification/cases', {
      token,
      body: { verificationType: 'IDENTITY' },
    });

    const empty = await request<ErrorBody>(
      'POST',
      `/verification/cases/${created.body.data.id}/submit`,
      { token },
    );
    expect(empty.status).toBe(400);

    await request('POST', `/verification/cases/${created.body.data.id}/documents/upload-url`, {
      token,
      body: IDENTITY_DOCUMENT,
    });

    const submitted = await request<CaseBody>(
      'POST',
      `/verification/cases/${created.body.data.id}/submit`,
      { token },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('SUBMITTED');

    const again = await request<ErrorBody>(
      'POST',
      `/verification/cases/${created.body.data.id}/submit`,
      { token },
    );
    expect(again.status).toBe(400);
  });

  it('blocks a provider from touching another provider case', async () => {
    const owner = await loginAsProvider();
    const stranger = await loginAsProvider();

    const created = await request<CaseBody>('POST', '/verification/cases', {
      token: owner.token,
      body: { verificationType: 'IDENTITY' },
    });

    const upload = await request<ErrorBody>(
      'POST',
      `/verification/cases/${created.body.data.id}/documents/upload-url`,
      { token: stranger.token, body: IDENTITY_DOCUMENT },
    );
    expect(upload.status).toBe(403);
    expect(upload.body.error.code).toBe('FORBIDDEN');

    const submit = await request<ErrorBody>(
      'POST',
      `/verification/cases/${created.body.data.id}/submit`,
      { token: stranger.token },
    );
    expect(submit.status).toBe(403);

    const missing = await request<ErrorBody>('POST', `/verification/cases/${randomUUID()}/submit`, {
      token: owner.token,
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses admin decisions without the admin role', async () => {
    const provider = await loginAsProvider();
    const created = await request<CaseBody>('POST', '/verification/cases', {
      token: provider.token,
      body: { verificationType: 'IDENTITY' },
    });
    await request('POST', `/verification/cases/${created.body.data.id}/documents/upload-url`, {
      token: provider.token,
      body: IDENTITY_DOCUMENT,
    });
    await request('POST', `/verification/cases/${created.body.data.id}/submit`, {
      token: provider.token,
    });

    const approve = await request<ErrorBody>(
      'POST',
      `/admin/verifications/${created.body.data.id}/approve`,
      { token: provider.token, body: { reasonCode: 'DOCUMENT_VERIFIED' } },
    );
    expect(approve.status).toBe(403);
    expect(approve.body.error.code).toBe('FORBIDDEN');

    const queue = await request<ErrorBody>('GET', '/admin/verifications', {
      token: provider.token,
    });
    expect(queue.status).toBe(403);
  });

  it('audits an admin approval and lifts the capability verification level', async () => {
    const provider = await loginAsProvider();
    const created = await request<CaseBody>('POST', '/verification/cases', {
      token: provider.token,
      body: { verificationType: 'IDENTITY' },
    });
    await request('POST', `/verification/cases/${created.body.data.id}/documents/upload-url`, {
      token: provider.token,
      body: IDENTITY_DOCUMENT,
    });
    await request('POST', `/verification/cases/${created.body.data.id}/submit`, {
      token: provider.token,
    });

    const admin = await login();
    await makeAdmin(admin.userId);

    const queue = await request<{ data: { items: { id: string; documentCount: number }[] } }>(
      'GET',
      '/admin/verifications',
      { token: admin.token },
    );
    expect(queue.status).toBe(200);
    expect(queue.body.data.items.some((item) => item.id === created.body.data.id)).toBe(true);

    const approved = await request<{
      data: { id: string; status: string; decisionReason: string };
    }>('POST', `/admin/verifications/${created.body.data.id}/approve`, {
      token: admin.token,
      body: { reasonCode: 'DOCUMENT_VERIFIED', notes: '证件清晰' },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.decisionReason).toBe('DOCUMENT_VERIFIED');

    const auditRows = await prisma.auditLog.findMany({
      where: { resourceType: 'verification_case', resourceId: created.body.data.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('VERIFICATION_APPROVED');
    expect(auditRows[0]?.actorUserId).toBe(admin.userId);
    expect(auditRows[0]?.beforeJson).toMatchObject({ status: 'SUBMITTED' });
    expect(auditRows[0]?.afterJson).toMatchObject({ status: 'APPROVED', notes: '证件清晰' });
    expect(auditRows[0]?.requestId).toBeTruthy();

    const [capability] = await prisma.providerCapability.findMany({
      where: { providerId: created.body.data.providerId },
    });
    expect(capability?.verificationLevel).toBe('IDENTITY');
  });

  it('requires a reason code to reject and audits the rejection', async () => {
    const provider = await loginAsProvider();
    const created = await request<CaseBody>('POST', '/verification/cases', {
      token: provider.token,
      body: { verificationType: 'IDENTITY' },
    });
    await request('POST', `/verification/cases/${created.body.data.id}/documents/upload-url`, {
      token: provider.token,
      body: IDENTITY_DOCUMENT,
    });
    await request('POST', `/verification/cases/${created.body.data.id}/submit`, {
      token: provider.token,
    });

    const admin = await login();
    await makeAdmin(admin.userId);

    const withoutReason = await request<ErrorBody>(
      'POST',
      `/admin/verifications/${created.body.data.id}/reject`,
      { token: admin.token, body: {} },
    );
    expect(withoutReason.status).toBe(400);
    expect(withoutReason.body.error.code).toBe('VALIDATION_ERROR');

    const rejected = await request<{ data: { status: string; decisionReason: string } }>(
      'POST',
      `/admin/verifications/${created.body.data.id}/reject`,
      { token: admin.token, body: { reasonCode: 'FAKE_CREDENTIALS' } },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(rejected.body.data.decisionReason).toBe('FAKE_CREDENTIALS');

    const auditRows = await prisma.auditLog.findMany({
      where: { resourceType: 'verification_case', resourceId: created.body.data.id },
    });
    expect(auditRows[0]?.action).toBe('VERIFICATION_REJECTED');
    expect(auditRows[0]?.afterJson).toMatchObject({ status: 'REJECTED' });

    // The provider can resubmit a rejected case.
    await request('POST', `/verification/cases/${created.body.data.id}/documents/upload-url`, {
      token: provider.token,
      body: { ...IDENTITY_DOCUMENT, documentType: 'OTHER' },
    });
    const resubmitted = await request<CaseBody>(
      'POST',
      `/verification/cases/${created.body.data.id}/submit`,
      { token: provider.token },
    );
    expect(resubmitted.body.data.status).toBe('RESUBMITTED');
  });

  it('grants audited, short-lived access to a private document', async () => {
    const provider = await loginAsProvider();
    const created = await request<CaseBody>('POST', '/verification/cases', {
      token: provider.token,
      body: { verificationType: 'IDENTITY' },
    });
    const upload = await request<{ data: { documentId: string } }>(
      'POST',
      `/verification/cases/${created.body.data.id}/documents/upload-url`,
      { token: provider.token, body: IDENTITY_DOCUMENT },
    );
    await request('POST', `/verification/cases/${created.body.data.id}/submit`, {
      token: provider.token,
    });

    // The owner never receives a document URL.
    const ownerAccess = await request<ErrorBody>(
      'POST',
      `/admin/verifications/${created.body.data.id}/documents/${upload.body.data.documentId}/access-url`,
      { token: provider.token, body: { reasonCode: 'REVIEW' } },
    );
    expect(ownerAccess.status).toBe(403);

    const admin = await login();
    await makeAdmin(admin.userId);

    const access = await request<{
      data: { documentId: string; downloadUrl: string; expiresAt: string };
    }>(
      'POST',
      `/admin/verifications/${created.body.data.id}/documents/${upload.body.data.documentId}/access-url`,
      { token: admin.token, body: { reasonCode: 'REVIEW' } },
    );
    expect(access.status).toBe(200);
    expect(access.body.data.downloadUrl).toMatch(/signature=[0-9a-f]{64}/);
    expect(new Date(access.body.data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      300_000,
    );

    const auditRows = await prisma.auditLog.findMany({
      where: { resourceType: 'verification_document', resourceId: upload.body.data.documentId },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('VERIFICATION_DOCUMENT_ACCESSED');
    expect(auditRows[0]?.actorUserId).toBe(admin.userId);
    expect(auditRows[0]?.afterJson).toMatchObject({ reasonCode: 'REVIEW' });
  });

  it('returns NOT_FOUND for an unknown decision target', async () => {
    const admin = await login();
    await makeAdmin(admin.userId);

    const response = await request<ErrorBody>(
      'POST',
      `/admin/verifications/${randomUUID()}/approve`,
      { token: admin.token, body: { reasonCode: 'OK' } },
    );
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

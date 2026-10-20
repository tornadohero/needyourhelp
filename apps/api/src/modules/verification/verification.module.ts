import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { resolveSealingKey } from '../../common/security/seal';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { ProviderModule } from '../provider/provider.module';
import { VerificationAdminService } from './application/verification-admin.service';
import { VerificationService } from './application/verification.service';
import { DOCUMENT_METADATA_CIPHER } from './domain/document-metadata-cipher';
import { LOCAL_OBJECT_STORE } from './domain/object-store';
import { OBJECT_STORAGE_GATEWAY } from './domain/object-storage.gateway';
import { VERIFICATION_CASE_REPOSITORY } from './domain/verification-case.repository';
import {
  DEFAULT_DOCUMENT_MAX_BYTES,
  VERIFICATION_DOCUMENT_MAX_BYTES,
} from './domain/verification-document-policy';
import { AdminVerificationController } from './http/admin-verification.controller';
import { FilesController } from './http/files.controller';
import { VerificationController } from './http/verification.controller';
import {
  AesGcmDocumentMetadataCipher,
  DOCUMENT_METADATA_KEY,
} from './infrastructure/aes-gcm-document-metadata.cipher';
import { MockObjectStorageGateway } from './infrastructure/mock-object-storage.gateway';
import { PrismaVerificationCaseRepository } from './infrastructure/prisma-verification-case.repository';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Verification context: cases, private evidence and the admin decision
 * (`specs/02-domain-model.md` §Verification aggregate).
 *
 * It depends on the provider context for the provider profile and for
 * recomputing `searchable`; the provider context never reads verification
 * tables, it only consumes the `VERIFICATION_READINESS` port (T005).
 */
@Module({
  imports: [AnalyticsModule, AuthModule, IdentityModule, AuditModule, ProviderModule],
  // `FilesController` is the local half of the signed object URLs: it is only
  // usable when the storage adapter exposes a local store (T028 gap G3).
  controllers: [VerificationController, AdminVerificationController, FilesController],
  providers: [
    VerificationService,
    VerificationAdminService,
    { provide: VERIFICATION_CASE_REPOSITORY, useClass: PrismaVerificationCaseRepository },
    { provide: DOCUMENT_METADATA_CIPHER, useClass: AesGcmDocumentMetadataCipher },
    {
      provide: DOCUMENT_METADATA_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        resolveSealingKey(
          config.get<string>('VERIFICATION_METADATA_KEY'),
          config.get<string>('NODE_ENV'),
          'VERIFICATION_METADATA_KEY',
        ),
    },
    {
      provide: OBJECT_STORAGE_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new MockObjectStorageGateway({
          environment: config.get<string>('NODE_ENV') ?? 'local',
          signingSecret:
            config.get<string>('OBJECT_STORAGE_SIGNING_SECRET') ?? 'local-object-storage-secret',
          baseUrl:
            config.get<string>('OBJECT_STORAGE_BASE_URL') ??
            `http://127.0.0.1:${config.get<string>('API_PORT') ?? '3000'}/api/v1/files`,
          uploadUrlTtlSeconds: Number(config.get<string>('VERIFICATION_UPLOAD_URL_TTL') ?? '900'),
          // Short-lived: document access must expire quickly (specs/10).
          downloadUrlTtlSeconds: Number(
            config.get<string>('VERIFICATION_DOWNLOAD_URL_TTL') ?? '300',
          ),
          maxBytes: Number(
            config.get<string>('VERIFICATION_DOCUMENT_MAX_BYTES') ?? DEFAULT_DOCUMENT_MAX_BYTES,
          ),
        }),
    },
    // Same adapter instance: the URL it signs is the URL this store serves.
    { provide: LOCAL_OBJECT_STORE, useExisting: OBJECT_STORAGE_GATEWAY },
    {
      provide: VERIFICATION_DOCUMENT_MAX_BYTES,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        Number(config.get<string>('VERIFICATION_DOCUMENT_MAX_BYTES') ?? DEFAULT_DOCUMENT_MAX_BYTES),
    },
  ],
  exports: [VerificationService, VerificationAdminService],
})
export class VerificationModule {}

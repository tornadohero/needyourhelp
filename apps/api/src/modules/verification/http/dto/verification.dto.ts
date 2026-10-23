import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  PROVIDER_TYPES,
  VERIFICATION_CASE_STATUSES,
  VERIFICATION_DOCUMENT_TYPES,
  VERIFICATION_TYPES,
  type ProviderTypeName,
  type VerificationCaseStatusName,
  type VerificationDocumentTypeName,
  type VerificationTypeName,
} from '@mentor/api-contracts';

import { DEFAULT_DOCUMENT_MAX_BYTES } from '../../domain/verification-document-policy';

/**
 * `POST /verification/cases`.
 *
 * There is deliberately no `status`, `providerId` or `reviewerId` field: those
 * are decided by the server (`AGENTS.md` §7). The global `ValidationPipe` runs
 * with `forbidNonWhitelisted`, so any extra property is rejected.
 */
export class CreateVerificationCaseDto {
  @IsEnum(VERIFICATION_TYPES)
  readonly verificationType!: VerificationTypeName;
}

/** `GET /verification/me?providerType=TUTORING`. */
export class MyVerificationQueryDto {
  @IsOptional()
  @IsEnum(PROVIDER_TYPES)
  readonly providerType?: ProviderTypeName;
}

/**
 * `POST /verification/cases/:id/documents/upload-url`.
 *
 * The object key is never accepted from the client: only the evidence
 * description is (`specs/13-security-spec.md` §File upload).
 */
export class RequestUploadUrlDto {
  @IsEnum(VERIFICATION_DOCUMENT_TYPES)
  readonly documentType!: VerificationDocumentTypeName;

  @IsString()
  @MaxLength(100)
  readonly contentType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DEFAULT_DOCUMENT_MAX_BYTES)
  readonly byteSize!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  readonly filename?: string;

  /**
   * Optional SHA-256 of the file.
   *
   * A WeChat mini program cannot compute one (`wx.getFileInfo` offers md5 and
   * sha1 only), so the hash is not a client duty: when it is absent the server
   * records it from the bytes it receives (`specs/13` §File upload). When a
   * client does send one, it must still be a SHA-256 hex digest.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i)
  readonly fileHash?: string;
}

/**
 * An admin decision (`specs/06` §Admin decision requirements):
 * a reason code is mandatory and notes are optional.
 */
export class VerificationDecisionDto {
  @IsString()
  @Matches(/^[A-Z0-9_]{2,64}$/)
  readonly reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly notes?: string;
}

/** `GET /admin/verifications?status=&limit=`. */
export class VerificationQueueQueryDto {
  @IsOptional()
  @IsEnum(VERIFICATION_CASE_STATUSES, { each: true })
  readonly status?: VerificationCaseStatusName[];

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit?: number;
}

/**
 * Access to a private document needs an explicit purpose
 * (`specs/12-admin-spec.md`: access is logged).
 */
export class DocumentAccessDto {
  @IsIn(['REVIEW'])
  readonly reasonCode!: 'REVIEW';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly notes?: string;
}

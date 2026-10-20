import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

import {
  CONSOLE_PASSWORD_MAX_LENGTH,
  CONSOLE_PASSWORD_MIN_LENGTH,
} from '../../domain/console-credential-policy';

/**
 * `POST /auth/wechat/login` body — `specs/05-api-spec.md` §Auth.
 *
 * Only `code` is accepted. There is deliberately no `userId`, `role` or profile
 * field: identity and roles are resolved server-side (`AGENTS.md` §7).
 * The global `ValidationPipe` runs with `forbidNonWhitelisted`, so any extra
 * property is rejected.
 */
export class WeChatLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  readonly code!: string;
}

/** `POST /auth/refresh` body. */
export class RefreshTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  readonly refreshToken!: string;
}

/** `POST /auth/logout` body: the refresh token is optional (Bearer also works). */
export class LogoutDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  readonly refreshToken?: string;
}

/**
 * `POST /auth/console/login` (T028 gap G1).
 *
 * Only `username`/`password`/`deviceLabel` are accepted: no role, no user id.
 * Identity and roles are resolved server-side (`AGENTS.md` §7).
 */
export class ConsoleLoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  readonly username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(CONSOLE_PASSWORD_MAX_LENGTH)
  readonly password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  readonly deviceLabel?: string;
}

/** `POST /admin/console-credentials`: issue or rotate an operator credential. */
export class IssueConsoleCredentialDto {
  @IsUUID()
  readonly userId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(64)
  readonly username!: string;

  @IsString()
  @MinLength(CONSOLE_PASSWORD_MIN_LENGTH)
  @MaxLength(CONSOLE_PASSWORD_MAX_LENGTH)
  readonly password!: string;
}

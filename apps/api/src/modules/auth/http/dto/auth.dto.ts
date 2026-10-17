import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

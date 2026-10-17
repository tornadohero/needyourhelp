import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IdentityModule } from '../identity/identity.module';

import { DEFAULT_ROLE } from './domain/auth-session.model';
import type { AuthServiceConfig } from './domain/auth.service';
import { AUTH_CONFIG, AUTH_SERVICE, AuthService } from './domain/auth.service';
import { ACCESS_TOKEN_SERVICE } from './domain/access-token.service';
import { SESSION_REPOSITORY } from './domain/session.repository';
import { WECHAT_AUTH_PROVIDER } from './domain/wechat-auth.provider';
import type { WeChatAuthProvider } from './domain/wechat-auth.provider';
import { JwtAccessTokenService } from './infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from './infrastructure/mock-wechat-auth.provider';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { WeChatHttpAuthProvider } from './infrastructure/wechat-http-auth.provider';
import { AuthController } from './http/auth.controller';
import { JwtAuthGuard } from './http/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './http/guards/optional-jwt-auth.guard';
import { RolesGuard } from './http/guards/roles.guard';

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEV_OPENID_PEPPER = 'dev-only-openid-pepper';

/**
 * Auth module wiring.
 *
 * Provider selection (`specs/03-architecture-spec.md` §External provider ports):
 * - `AUTH_PROVIDER=wechat` uses the real `code2Session` adapter;
 * - `AUTH_PROVIDER=mock` (default outside production) uses the deterministic
 *   mock adapter, which refuses to run in production.
 */
@Module({
  imports: [IdentityModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: AUTH_SERVICE, useExisting: AuthService },
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RolesGuard,
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    {
      provide: ACCESS_TOKEN_SERVICE,
      useFactory: (config: ConfigService): JwtAccessTokenService =>
        new JwtAccessTokenService({
          secret: requireSecret(config, 'ACCESS_TOKEN_SECRET'),
          ttlSeconds: toPositiveInt(
            config.get<string>('AUTH_ACCESS_TOKEN_TTL_SECONDS'),
            DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
          ),
          issuer: config.get<string>('AUTH_TOKEN_ISSUER') ?? 'mentor-platform',
        }),
      inject: [ConfigService],
    },
    {
      provide: WECHAT_AUTH_PROVIDER,
      useFactory: (config: ConfigService): WeChatAuthProvider => {
        const environment = config.get<string>('NODE_ENV') ?? 'local';
        const provider = (config.get<string>('AUTH_PROVIDER') ?? '').toLowerCase();
        const useMock =
          provider === 'mock' || (provider !== 'wechat' && environment !== 'production');

        if (useMock) {
          return new MockWeChatAuthProvider({ environment });
        }

        return new WeChatHttpAuthProvider({
          appId: config.get<string>('WECHAT_APP_ID') ?? '',
          appSecret: config.get<string>('WECHAT_APP_SECRET') ?? '',
        });
      },
      inject: [ConfigService],
    },
    {
      provide: AUTH_CONFIG,
      useFactory: (config: ConfigService): AuthServiceConfig => {
        const environment = config.get<string>('NODE_ENV') ?? 'local';
        const pepper = config.get<string>('OPENID_HASH_PEPPER');
        if (!pepper && environment === 'production') {
          throw new Error('OPENID_HASH_PEPPER is required in production.');
        }

        return {
          accessTokenTtlSeconds: toPositiveInt(
            config.get<string>('AUTH_ACCESS_TOKEN_TTL_SECONDS'),
            DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
          ),
          refreshTokenTtlSeconds: toPositiveInt(
            config.get<string>('AUTH_REFRESH_TOKEN_TTL_SECONDS'),
            DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
          ),
          openidPepper: pepper ?? DEV_OPENID_PEPPER,
          defaultRoles: [DEFAULT_ROLE],
        };
      },
      inject: [ConfigService],
    },
  ],
  exports: [AUTH_SERVICE, JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard],
})
export class AuthModule {}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requireSecret(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  const environment = config.get<string>('NODE_ENV') ?? 'local';
  if (value && value.length > 0) {
    return value;
  }
  if (environment === 'production') {
    throw new Error(`${key} is required in production.`);
  }
  return `dev-only-${key.toLowerCase()}`;
}

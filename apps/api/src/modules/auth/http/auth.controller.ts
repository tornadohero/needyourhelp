import type { Request } from 'express';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  TOKEN_TYPE,
  type AuthTokensResponse,
  type LoginResponse,
  type LogoutResponse,
  type MeResponse,
} from '@mentor/api-contracts';

import { sha256Hex } from '../../../common/security/hash';
import { AuthDomainError } from '../domain/auth-errors';
import type { AuthService } from '../domain/auth.service';
import { AUTH_SERVICE } from '../domain/auth.service';
import type { AuthPrincipal } from '../domain/auth-session.model';
import { CurrentUser, MaybeCurrentUser } from './decorators/current-user.decorator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { LogoutDto, RefreshTokenDto, WeChatLoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { RateLimit } from '../../../common/security/rate-limit.interceptor';

/**
 * Auth endpoints (`specs/05-api-spec.md` §Auth).
 *
 * Controllers only authenticate, validate, invoke the service and map the
 * response (`AGENTS.md` §6).
 */
@Controller()
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly authService: AuthService) {}

  @RateLimit('auth.login')
  @Post('auth/wechat/login')
  async login(@Body() body: WeChatLoginDto, @Req() request: Request): Promise<LoginResponse> {
    return this.run(async () => {
      const result = await this.authService.loginWithWeChatCode({
        code: body.code,
        ipHash: hashOptional(request.ip),
        userAgentHash: hashOptional(request.headers['user-agent']),
      });

      return {
        tokenType: TOKEN_TYPE,
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        expiresIn: result.session.expiresIn,
        user: result.user,
      };
    });
  }

  @Post('auth/refresh')
  async refresh(@Body() body: RefreshTokenDto): Promise<AuthTokensResponse> {
    return this.run(async () => {
      const result = await this.authService.refresh({ refreshToken: body.refreshToken });

      return {
        tokenType: TOKEN_TYPE,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
      };
    });
  }

  @Post('auth/logout')
  @UseGuards(OptionalJwtAuthGuard)
  async logout(
    @Body() body: LogoutDto,
    @MaybeCurrentUser() principal: AuthPrincipal | undefined,
  ): Promise<LogoutResponse> {
    return this.run(async () => {
      await this.authService.logout({
        refreshToken: body.refreshToken ?? null,
        principal: principal ?? null,
      });
      return { revoked: true } satisfies LogoutResponse;
    });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() principal: AuthPrincipal): Promise<MeResponse> {
    return this.run(() => this.authService.describePrincipal(principal));
  }

  /**
   * Translate domain failures into the API error envelope; anything else is
   * handled by the global filter (never leaked to the client).
   */
  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AuthDomainError) {
        throw new HttpException({ code: error.code, message: error.message }, error.status);
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        { code: 'AUTH_REQUIRED', message: 'Authentication is required.' },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}

function hashOptional(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return sha256Hex(value);
}

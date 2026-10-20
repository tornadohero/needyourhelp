import type { Request } from 'express';
import {
  Body,
  Controller,
  Delete,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  TOKEN_TYPE,
  type ConsoleCredentialResponse,
  type ConsoleCredentialRevocationResponse,
  type LoginResponse,
} from '@mentor/api-contracts';

import { sha256Hex } from '../../../common/security/hash';
import { RateLimit } from '../../../common/security/rate-limit.interceptor';
import { getRequestId } from '../../../common/http/request-context';
import { hashRequestIp } from '../../../common/http/request-ip';
import { AuthDomainError } from '../domain/auth-errors';
import { ConsoleCredentialService } from '../domain/console-credential.service';
import type { AuthService } from '../domain/auth.service';
import { AUTH_SERVICE } from '../domain/auth.service';
import type { AuthPrincipal } from '../domain/auth-session.model';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
// Value import on purpose: `ValidationPipe` needs the DTO classes at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConsoleLoginDto, IssueConsoleCredentialDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

/**
 * Admin console authentication (T028 gap G1).
 *
 * - `POST /auth/console/login` is public but rate-limited and lockout-protected;
 * - issuing/revoking a credential is an operator action behind `ADMIN`/`OPS`.
 *
 * Nothing here lowers an existing rule: the console credential only ever unlocks
 * the console for an account that already holds an operator role.
 */
@Controller()
export class ConsoleAuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly authService: AuthService,
    @Inject(ConsoleCredentialService)
    private readonly credentials: ConsoleCredentialService,
  ) {}

  @Post('auth/console/login')
  @RateLimit('auth.console')
  async login(@Body() body: ConsoleLoginDto, @Req() request: Request): Promise<LoginResponse> {
    return this.run(async () => {
      const result = await this.authService.loginWithConsoleCredential({
        username: body.username,
        password: body.password,
        deviceLabel: body.deviceLabel ?? null,
        ipHash: hashRequestIp(request),
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

  /** `POST /admin/console-credentials`: issue or rotate an operator credential. */
  @Post('admin/console-credentials')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPS')
  async issueCredential(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: IssueConsoleCredentialDto,
    @Req() request: Request,
  ): Promise<ConsoleCredentialResponse> {
    return this.run(async () =>
      this.credentials.issue(
        {
          actorUserId: principal.userId,
          ipHash: hashRequestIp(request),
          requestId: getRequestId(request),
        },
        { userId: body.userId, username: body.username, password: body.password },
      ),
    );
  }

  /** `DELETE /admin/console-credentials/:userId`: revoke console access. */
  @Delete('admin/console-credentials/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPS')
  async revokeCredential(
    @CurrentUser() principal: AuthPrincipal,
    @Param('userId') userId: string,
    @Req() request: Request,
  ): Promise<ConsoleCredentialRevocationResponse> {
    return this.run(async () => {
      const result = await this.credentials.revoke(
        {
          actorUserId: principal.userId,
          ipHash: hashRequestIp(request),
          requestId: getRequestId(request),
        },
        userId,
      );
      return { userId: result.userId, revoked: true as const };
    });
  }

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

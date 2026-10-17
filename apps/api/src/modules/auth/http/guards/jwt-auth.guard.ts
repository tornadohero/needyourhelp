import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { AUTH_SERVICE } from '../../domain/auth.service';
import type { AuthService } from '../../domain/auth.service';
import type { AuthDomainError } from '../../domain/auth-errors';
import { writePrincipal } from '../decorators/current-user.decorator';
import { extractBearerToken } from './bearer-token';

/**
 * Authenticates every protected route.
 *
 * - the user id always comes from the verified token, never from the request;
 * - a revoked or expired session is rejected even if the JWT is still valid
 *   (`specs/13-security-spec.md` §Authentication).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(AUTH_SERVICE) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required.',
      });
    }

    try {
      const principal = await this.authService.authenticateAccessToken(token);
      writePrincipal(request, principal);
      return true;
    } catch (error) {
      const domainError = error as AuthDomainError;
      throw new UnauthorizedException({
        code: typeof domainError?.code === 'string' ? domainError.code : 'AUTH_REQUIRED',
        message:
          typeof domainError?.message === 'string' && domainError.message.length > 0
            ? domainError.message
            : 'Authentication is required.',
      });
    }
  }
}

import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthService } from '../../domain/auth.service';
import { AUTH_SERVICE } from '../../domain/auth.service';
import { writePrincipal } from '../decorators/current-user.decorator';
import { extractBearerToken } from './bearer-token';

/**
 * Resolves the caller when a bearer token is present, without rejecting
 * anonymous requests.
 *
 * Used by logout so a client whose access token already expired can still log
 * out with its refresh token.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(@Inject(AUTH_SERVICE) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      return true;
    }

    try {
      writePrincipal(request, await this.authService.authenticateAccessToken(token));
    } catch {
      // An invalid/expired access token must not block a refresh-token logout.
    }

    return true;
  }
}

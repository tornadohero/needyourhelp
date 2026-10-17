import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Secure response headers (`specs/13-security-spec.md` §API: "secure headers").
 *
 * The API is JSON only and is never embedded, so the policy is the narrowest one
 * that still works: nothing may frame it, nothing may sniff it, nothing may
 * cache a response that carries personal data, and no resource of any kind may
 * load (`default-src 'none'`).
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction): void {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    // Every answer may carry personal data: nothing may keep a copy.
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    // Only meaningful over TLS, and harmless otherwise.
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  }
}

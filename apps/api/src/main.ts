import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { API_BASE } from '@mentor/api-contracts';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { RateLimitInterceptor } from './common/security/rate-limit.interceptor';
import { resolveCorsOptions } from './common/security/cors-policy';

async function bootstrap(): Promise<void> {
  // `rawBody` keeps the exact bytes WeChat signed for the payment notification;
  // the signature is invalid if the body is re-serialized.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);

  // Security spec §API: do not advertise the underlying framework.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // §API: CORS is an allowlist. With nothing configured, no browser origin can
  // read a response at all.
  const cors = resolveCorsOptions(
    configService.get<string>('CORS_ALLOWED_ORIGINS'),
    configService.get<string>('NODE_ENV'),
  );
  if (cors.origin !== false) {
    app.enableCors({
      origin: cors.origin,
      methods: cors.methods,
      allowedHeaders: cors.allowedHeaders,
      credentials: cors.credentials,
      maxAge: cors.maxAgeSeconds,
    });
  }

  app.setGlobalPrefix(API_BASE.replace(/^\/+/, ''));
  app.useGlobalFilters(new AllExceptionsFilter());
  // The rate limiter runs as an interceptor so an account-scoped policy counts
  // the signed-in account and not the address in front of it.
  app.useGlobalInterceptors(
    new ResponseEnvelopeInterceptor(),
    app.get(RateLimitInterceptor, { strict: false }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(configService.get<string>('API_PORT') ?? 3000);
  await app.listen(port);
}

void bootstrap();

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { AppController } from '../../src/app.controller';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Operations probes over HTTP (T024: monitoring).
 *
 * A readiness probe that is answered by a controller wired differently from
 * production is a probe that lies, so this one drives the real controller.
 */
describeWithDatabase('operations probes', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof createTestPrismaService>;

  beforeAll(async () => {
    prisma = createTestPrismaService();
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: ConfigService, useValue: { get: () => 'test' } as unknown as ConfigService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // The envelope is what production answers with, so the probe is read as a
    // client would read it.
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    await app.init();
    await app.listen(0);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  function url(path: string): string {
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return `http://127.0.0.1:${port}${path}`;
  }

  it('answers liveness and readiness', async () => {
    const live = await fetch(url('/health'));
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ data: { status: 'ok', service: 'api' } });

    const ready = await fetch(url('/health/ready'));
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ status: 'ok', database: 'up' });
    // One bit about the database, nothing about where it lives.
    expect(JSON.stringify(body)).not.toMatch(/postgres|5432|password/);
  });

  it('fails readiness when the database is unreachable', async () => {
    const broken = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: ConfigService, useValue: { get: () => 'test' } as unknown as ConfigService },
        {
          provide: PrismaService,
          useValue: { $queryRaw: () => Promise.reject(new Error('connection refused')) },
        },
      ],
    }).compile();

    const brokenApp = broken.createNestApplication();
    await brokenApp.init();
    await brokenApp.listen(0);
    const address = brokenApp.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;

    // Fails closed: a probe that cannot reach the database must not say "ok".
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/postgres|5432|password/);

    await brokenApp.close();
  });
});

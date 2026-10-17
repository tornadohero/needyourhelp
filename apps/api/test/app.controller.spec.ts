import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { AppController } from '../src/app.controller';
import { AccessLogMiddleware } from '../src/common/monitoring/access-log.middleware';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

/** A `PrismaService` that either answers the probe query or fails like a dead database. */
function databaseStub(options: { reachable?: boolean } = {}) {
  return {
    $queryRaw:
      options.reachable === false
        ? () => Promise.reject(new Error('down'))
        : () => Promise.resolve([{ '?column?': 1 }]),
  };
}

async function controllerWith(database: unknown): Promise<TestingModule> {
  return Test.createTestingModule({
    controllers: [AppController],
    providers: [
      { provide: ConfigService, useValue: { get: () => 'test' } as unknown as ConfigService },
      { provide: PrismaService, useValue: database },
    ],
  }).compile();
}

describe('AppController', () => {
  it('reports health without exposing infrastructure details', async () => {
    const moduleRef: TestingModule = await controllerWith(databaseStub());

    const controller = moduleRef.get(AppController);
    const result = controller.health();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('api');
    expect(result.env).toBe('test');
    expect(Object.keys(result).sort()).toEqual(['env', 'service', 'status', 'time']);
  });

  it('reports readiness as up when the database answers', async () => {
    const moduleRef = await controllerWith(databaseStub());
    const result = await moduleRef.get(AppController).ready();

    expect(result).toMatchObject({ status: 'ok', service: 'api', database: 'up' });
    expect(result.databaseLatencyMs).toBeGreaterThanOrEqual(0);
    // One bit about the database, and nothing about how to reach it.
    expect(JSON.stringify(result)).not.toMatch(/postgres|localhost|5432/);
  });

  it('fails the readiness probe when the database is unreachable', async () => {
    const moduleRef = await controllerWith(databaseStub({ reachable: false }));

    await expect(moduleRef.get(AppController).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('AccessLogMiddleware', () => {
  function harness() {
    const listeners: Record<string, (() => void)[]> = {};
    const response = {
      statusCode: 200,
      on: (event: string, handler: () => void) => {
        listeners[event] = [...(listeners[event] ?? []), handler];
      },
      finish: () => (listeners['finish'] ?? []).forEach((handler) => handler()),
    };
    return response;
  }

  it('writes one structured line per request, without the query string', () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const middleware = new AccessLogMiddleware();
    const response = harness();

    middleware.use(
      {
        method: 'GET',
        originalUrl: '/api/v1/files/verification/abc?signature=SECRET&expires=1',
        ip: '203.0.113.7',
        header: () => undefined,
        headers: { authorization: 'Bearer tok' },
      } as never,
      response as never,
      (() => undefined) as never,
    );
    response.finish();

    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ kind: 'access', method: 'GET', status: 200 });
    expect(line.path).toBe('/api/v1/files/verification/abc');
    // Nothing signed, nothing identifying: the query string and the raw address
    // stay out of the log (`specs/13` §Logging).
    expect(JSON.stringify(line)).not.toContain('SECRET');
    expect(JSON.stringify(line)).not.toContain('203.0.113.7');
    expect(line.ipHash).toBeTruthy();
    expect(JSON.stringify(line)).not.toContain('tok');
    log.mockRestore();
  });

  it('keeps probe traffic out of the log', () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const middleware = new AccessLogMiddleware();
    const response = harness();

    middleware.use(
      { method: 'GET', originalUrl: '/api/v1/health/ready', ip: '203.0.113.7' } as never,
      response as never,
      (() => undefined) as never,
    );
    response.finish();

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AppController } from '../src/app.controller';

describe('AppController', () => {
  it('reports health without exposing infrastructure details', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: ConfigService,
          useValue: { get: () => 'test' } as unknown as ConfigService,
        },
      ],
    }).compile();

    const controller = moduleRef.get(AppController);
    const result = controller.health();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('api');
    expect(result.env).toBe('test');
    expect(Object.keys(result).sort()).toEqual(['env', 'service', 'status', 'time']);
  });
});

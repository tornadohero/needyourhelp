import { ApiClient } from './core/http';
import type { Transport } from './core/http';
import { SessionManager } from './core/session';
import type { TokenStore } from './core/session';
import { resolveApiOrigin } from './core/env';
import { config } from './config';
import { createWechatTokenStore, createWechatTransport } from './platform/wechat';

/**
 * One client and one session per app instance (T028).
 *
 * The context is created lazily so a test (or a preview without `wx`) can build
 * the same object graph with its own transport and store.
 */
export interface MentorContext {
  client: ApiClient;
  session: SessionManager;
}

export interface ContextOverrides {
  transport?: Transport;
  store?: TokenStore;
  origin?: string;
}

let context: MentorContext | null = null;

export function createMentorContext(overrides: ContextOverrides = {}): MentorContext {
  const client = new ApiClient({
    origin: overrides.origin ?? resolveApiOrigin({ configured: config.apiOrigin, env: config.env }),
    transport: overrides.transport ?? createWechatTransport(),
  });

  const session = new SessionManager({
    client,
    store: overrides.store ?? createWechatTokenStore(),
  });

  return { client, session };
}

/** The app-wide instance; created on first use. */
export function ensureContext(): MentorContext {
  if (!context) {
    context = createMentorContext();
  }
  return context;
}

/** Test seam: forget the instance so the next call rebuilds it. */
export function resetContext(): void {
  context = null;
}

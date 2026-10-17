/**
 * CORS allowlist (`specs/13-security-spec.md` §API: "CORS allowlist").
 *
 * The API is called by the mini program and, later, by an admin web app. Both
 * are known origins, so the default is *no* cross-origin access at all: an
 * operator has to name an origin in `CORS_ALLOWED_ORIGINS` before a browser can
 * read a response.
 */
export interface CorsOptions {
  origin: string[] | false;
  methods: string[];
  allowedHeaders: string[];
  credentials: boolean;
  maxAgeSeconds: number;
}

export function resolveCorsOptions(configured?: string, nodeEnv = 'local'): CorsOptions {
  const origins = (configured ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  // `*` is refused: a wildcard origin with credentials is not an allowlist.
  const allowed = origins.filter((origin) => origin !== '*');
  if (allowed.length === 0 && nodeEnv === 'production') {
    // Production without an allowlist stays closed rather than falling back.
    return closedCors();
  }
  if (allowed.length === 0) {
    return closedCors();
  }

  return {
    origin: allowed,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-request-id'],
    credentials: true,
    maxAgeSeconds: 600,
  };
}

function closedCors(): CorsOptions {
  return {
    origin: false,
    methods: [],
    allowedHeaders: [],
    credentials: false,
    maxAgeSeconds: 0,
  };
}

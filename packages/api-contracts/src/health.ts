/** Health probe payload. Deliberately exposes no infrastructure secrets. */
export interface HealthResponse {
  status: 'ok';
  service: 'api';
  env: string;
  time: string;
}

/**
 * Readiness probe payload (T024: monitoring).
 *
 * Liveness (`/health`) only says the process is running; readiness also says
 * the platform can reach its database, which is what a load balancer and an
 * alert need to know before they send traffic or wake somebody up.
 *
 * It exposes one bit — whether the database answered — and nothing else: no
 * host, no version, no connection string, no row counts.
 */
export interface ReadinessResponse {
  status: 'ok';
  service: 'api';
  /** Whether the database answered `SELECT 1`. */
  database: 'up' | 'down';
  /** Round-trip of the probe query, in milliseconds. */
  databaseLatencyMs: number;
  env: string;
  time: string;
}

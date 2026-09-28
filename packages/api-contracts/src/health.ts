/** Health probe payload. Deliberately exposes no infrastructure secrets. */
export interface HealthResponse {
  status: 'ok';
  service: 'api';
  env: string;
  time: string;
}

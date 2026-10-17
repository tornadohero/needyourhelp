import { hmacHex } from '../security/hash';

/**
 * Hash of the caller IP for audit rows.
 *
 * The raw address is never stored (`AGENTS.md` §9). HMAC is used because an IP
 * is low-entropy and a plain digest would be trivially reversible.
 */
export function hashRequestIp(request: { ip?: string } | undefined): string | null {
  const ip = request?.ip;
  return ip ? hmacHex(ip, 'audit-ip') : null;
}

const ACCOUNT = /^G[A-Z2-7]{55}$/;
const CONTRACT = /^C[A-Z2-7]{55}$/;
const MUXED = /^M[A-Z2-7]{68}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;
const HEX_HASH = /^(?:0x[0-9a-f]{16,}|[0-9a-f]{32,})$/i;

function normalizeSegment(segment: string): string {
  if (MUXED.test(segment)) return ':muxed';
  if (CONTRACT.test(segment)) return ':contract';
  if (ACCOUNT.test(segment)) return ':account';
  if (UUID.test(segment)) return ':uuid';
  if (NUMERIC.test(segment)) return ':id';
  if (HEX_HASH.test(segment)) return ':hash';
  return segment;
}

/** Hard-coded path rules from the RFP. No tenant-supplied patterns. */
export function normalizePath(input: string): string {
  const noHash = input.split('#')[0] ?? '';
  const path = noHash.split('?')[0] ?? '';
  const leading = path.startsWith('/');
  const segments = path.split('/').filter((part) => part.length > 0).map(normalizeSegment);
  if (segments.length === 0) return '/';
  return (leading ? '/' : '') + segments.join('/');
}

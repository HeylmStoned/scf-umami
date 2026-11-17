import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePath } from './normalize.ts';

const account = `G${'A'.repeat(55)}`;
const contract = `C${'B'.repeat(55)}`;
const muxed = `M${'C'.repeat(68)}`;

test('replaces ids, uuids, hashes, and Stellar strkeys', () => {
  const raw = `/accounts/${account}/contracts/${contract}/muxed/${muxed}/users/42/jobs/550e8400-e29b-41d4-a716-446655440000/tx/0xabc123def4567890/?ok=1`;
  assert.equal(
    normalizePath(raw),
    '/accounts/:account/contracts/:contract/muxed/:muxed/users/:id/jobs/:uuid/tx/:hash',
  );
});

test('drops the trailing slash and keeps ordinary words', () => {
  assert.equal(normalizePath('/markets/usdc/'), '/markets/usdc');
  assert.equal(normalizePath('/feed'), '/feed');
  assert.equal(normalizePath('/'), '/');
});

test('treats a long hex segment as a hash', () => {
  assert.equal(normalizePath(`/tx/${'ab'.repeat(32)}`), '/tx/:hash');
});

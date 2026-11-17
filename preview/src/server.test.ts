import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_ROSTER, seedDemo } from './seed.ts';
import { startServer } from './server.ts';
import { MemoryStore } from './store.ts';

const account = `G${'A'.repeat(55)}`;

async function post(url: string, token: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(url + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

test('a tenant cannot see or write another project', async () => {
  const store = new MemoryStore('operator-token');
  const server = await startServer({ store });
  try {
    const createdA = await post(server.url, 'operator-token', '/tenants', { id: 'alpha' });
    const createdB = await post(server.url, 'operator-token', '/tenants', { id: 'beta' });
    const tokenA = String(createdA.json.token);
    const tokenB = String(createdB.json.token);

    const trace = (tenantId: string) => ({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'tenant.id', value: { stringValue: tenantId } },
              { key: 'service.name', value: { stringValue: 'api' } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'should-not-leak',
                  startTimeUnixNano: '0',
                  endTimeUnixNano: '40000000',
                  attributes: [
                    { key: 'http.route', value: { stringValue: `/accounts/${account}/` } },
                    { key: 'http.response.status_code', value: { intValue: 201 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
      resourceLogs: [{ scopeLogs: [{ logRecords: [{ body: { stringValue: 'deep log' } }] }] }],
    });

    const stored = await post(server.url, tokenA, '/v1/traces', trace('alpha'));
    assert.equal(stored.status, 200);
    assert.equal(stored.json.droppedSpans, 1);
    assert.equal(stored.json.droppedLogs, 1);
    assert.equal(JSON.stringify(stored.json).includes('should-not-leak'), false);
    assert.equal(JSON.stringify(stored.json).includes('deep log'), false);

    const spoofed = await post(server.url, tokenA, '/v1/traces', trace('beta'));
    assert.equal(spoofed.status, 403);

    await post(server.url, tokenB, '/v1/traces', trace('beta'));
    await post(server.url, tokenA, '/s/e', { path: `/people/${account}/` });

    const own = await fetch(server.url + '/metrics/api', { headers: { authorization: `Bearer ${tokenA}` } });
    const ownBody = (await own.json()) as { rows: Array<{ tenantId: string; route: string }> };
    assert.deepEqual(ownBody.rows.map((row) => row.tenantId), ['alpha']);
    assert.equal(ownBody.rows[0]?.route, '/accounts/:account');

    const other = await fetch(server.url + '/metrics/api?tenant=beta', { headers: { authorization: `Bearer ${tokenA}` } });
    assert.equal(other.status, 403);

    const all = await fetch(server.url + '/metrics/api?all=1', { headers: { authorization: 'Bearer operator-token' } });
    const allBody = (await all.json()) as { rows: Array<{ tenantId: string }> };
    assert.deepEqual(allBody.rows.map((row) => row.tenantId).sort(), ['alpha', 'beta']);

    const pages = await fetch(server.url + '/metrics/web', { headers: { authorization: `Bearer ${tokenA}` } });
    const pageBody = (await pages.json()) as { rows: Array<{ path: string }> };
    assert.equal(pageBody.rows[0]?.path, '/people/:account');
  } finally {
    await server.close();
  }
});

test('the dashboard is served and the demo roster stays off unless asked', async () => {
  const plain = await startServer({ store: new MemoryStore('operator-token') });
  try {
    const page = await fetch(plain.url + '/');
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await page.text(), /Web and API analytics/);
    assert.equal((await fetch(plain.url + '/demo/roster')).status, 404);
  } finally {
    await plain.close();
  }

  const store = new MemoryStore(DEMO_ROSTER.operatorToken);
  await seedDemo(store);
  const demo = await startServer({ store, demo: DEMO_ROSTER });
  try {
    const roster = await fetch(demo.url + '/demo/roster');
    const body = (await roster.json()) as { tenants: Array<{ id: string }> };
    assert.deepEqual(body.tenants.map((tenant) => tenant.id), ['alpha', 'beta']);
    const alpha = await fetch(demo.url + '/metrics/web', { headers: { authorization: 'Bearer alpha-dev-token' } });
    const rows = (await alpha.json()) as { rows: Array<{ tenantId: string; path: string }> };
    assert.ok(rows.rows.every((row) => row.tenantId === 'alpha'));
    assert.ok(rows.rows.some((row) => row.path === '/'));
    assert.ok(rows.rows.some((row) => row.path === '/accounts/:account'));
  } finally {
    await demo.close();
  }
});

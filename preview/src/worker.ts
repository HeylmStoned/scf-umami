import { normalizePath } from './normalize.ts';
import { parseOtlp } from './otlp.ts';
import { DEMO_ROSTER, seedDemo } from './seed.ts';
import { MemoryStore, type Principal, type Store } from './store.ts';

const MAX_BODY = 1_000_000;

type Env = {
  ASSETS: { fetch: (input: Request) => Promise<Response> };
};

const store = new MemoryStore(DEMO_ROSTER.operatorToken);
const ready = seedDemo(store);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function bearer(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

function canRead(principal: Principal, tenantId: string | undefined, all: boolean): string | undefined | 'deny' {
  if (principal.role === 'operator') return all ? undefined : tenantId;
  if (all) return 'deny';
  if (tenantId && tenantId !== principal.tenantId) return 'deny';
  return principal.tenantId;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('body too large');
  if (text.length === 0) return {};
  return JSON.parse(text) as unknown;
}

async function handleSignals(store: Store, principal: Principal, request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('protobuf')) return json(415, { error: 'this spike accepts OTLP JSON only' });
  const parsed = parseOtlp(await readJson(request));
  if (principal.role === 'tenant' && parsed.requests.some((row) => row.tenantId !== principal.tenantId)) {
    return json(403, { error: 'tenant.id does not match the token' });
  }
  let stored = 0;
  for (const row of parsed.requests) {
    await store.addApi({
      tenantId: row.tenantId,
      serviceName: row.serviceName,
      route: normalizePath(row.route),
      statusCode: row.statusCode,
      durationMs: row.durationMs,
    });
    stored += 1;
  }
  return json(200, {
    stored,
    droppedSpans: parsed.droppedSpans,
    droppedLogs: parsed.droppedLogs,
    retained: 'route, status, latency histogram',
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      await ready;
      const url = new URL(request.url);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return env.ASSETS.fetch(request);
      }
      if (request.method === 'GET' && url.pathname === '/demo/roster') {
        return json(200, DEMO_ROSTER);
      }

      const principal = await store.principal(bearer(request));
      if (!principal) return json(401, { error: 'missing or unknown token' });

      if (request.method === 'POST' && url.pathname === '/tenants') {
        if (principal.role !== 'operator') return json(403, { error: 'operator token required' });
        const body = (await readJson(request)) as { id?: string };
        if (!body.id) return json(400, { error: 'id is required' });
        const token = await store.addTenant(body.id);
        return json(201, { tenantId: body.id, token });
      }

      if (request.method === 'POST' && url.pathname === '/v1/traces') {
        return handleSignals(store, principal, request);
      }

      if (request.method === 'POST' && url.pathname === '/v1/logs') {
        const parsed = parseOtlp(await readJson(request));
        return json(200, { stored: false, droppedLogs: parsed.droppedLogs });
      }

      if (request.method === 'POST' && url.pathname === '/s/e') {
        if (principal.role !== 'tenant') return json(403, { error: 'tenant token required' });
        const body = (await readJson(request)) as { path?: string };
        if (!body.path) return json(400, { error: 'path is required' });
        const path = normalizePath(body.path);
        await store.addPageview(principal.tenantId, path);
        return json(200, { path });
      }

      if (request.method === 'GET' && (url.pathname === '/metrics/api' || url.pathname === '/metrics/web')) {
        const requested = url.searchParams.get('tenant') ?? undefined;
        const all = url.searchParams.get('all') === '1';
        const scope = canRead(principal, requested, all);
        if (scope === 'deny') return json(403, { error: 'tenant cannot read another project' });
        const rows = url.pathname === '/metrics/api' ? await store.apiRows(scope) : await store.webRows(scope);
        return json(200, { rows });
      }

      if (request.method === 'GET') return env.ASSETS.fetch(request);
      return json(404, { error: 'not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error';
      return json(400, { error: message });
    }
  },
};

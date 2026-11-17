import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath } from './normalize.ts';
import { parseOtlp } from './otlp.ts';
import { type DemoRoster } from './seed.ts';
import { PgStore } from './pg-store.ts';
import { MemoryStore, type Principal, type Store } from './store.ts';

const pagePath = join(dirname(fileURLToPath(import.meta.url)), 'public', 'index.html');

function dashboardPage(): string {
  return readFileSync(pagePath, 'utf8');
}

const MAX_BODY = 1_000_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

async function authorize(store: Store, req: IncomingMessage): Promise<Principal | undefined> {
  return store.principal(bearer(req));
}

function canRead(principal: Principal, tenantId: string | undefined, all: boolean): string | undefined | 'deny' {
  if (principal.role === 'operator') return all ? undefined : tenantId;
  if (all) return 'deny';
  if (tenantId && tenantId !== principal.tenantId) return 'deny';
  return principal.tenantId;
}

export async function startServer(options: { port?: number; store: Store; demo?: DemoRoster }): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(dashboardPage());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/demo/roster') {
        if (!options.demo) return send(res, 404, { error: 'not found' });
        return send(res, 200, options.demo);
      }
      const principal = await authorize(options.store, req);
      if (!principal) return send(res, 401, { error: 'missing or unknown token' });

      if (req.method === 'POST' && url.pathname === '/tenants') {
        if (principal.role !== 'operator') return send(res, 403, { error: 'operator token required' });
        const body = (await readJson(req)) as { id?: string };
        if (!body.id) return send(res, 400, { error: 'id is required' });
        const token = await options.store.addTenant(body.id);
        return send(res, 201, { tenantId: body.id, token });
      }

      if (req.method === 'POST' && url.pathname === '/v1/traces') {
        return handleSignals(options.store, principal, req, res);
      }

      if (req.method === 'POST' && url.pathname === '/v1/logs') {
        const parsed = parseOtlp(await readJson(req));
        return send(res, 200, { stored: false, droppedLogs: parsed.droppedLogs });
      }

      if (req.method === 'POST' && url.pathname === '/s/e') {
        if (principal.role !== 'tenant') return send(res, 403, { error: 'tenant token required' });
        const body = (await readJson(req)) as { path?: string };
        if (!body.path) return send(res, 400, { error: 'path is required' });
        const path = normalizePath(body.path);
        await options.store.addPageview(principal.tenantId, path);
        return send(res, 200, { path });
      }

      if (req.method === 'GET' && (url.pathname === '/metrics/api' || url.pathname === '/metrics/web')) {
        const requested = url.searchParams.get('tenant') ?? undefined;
        const all = url.searchParams.get('all') === '1';
        const scope = canRead(principal, requested, all);
        if (scope === 'deny') return send(res, 403, { error: 'tenant cannot read another project' });
        const rows = url.pathname === '/metrics/api'
          ? await options.store.apiRows(scope)
          : await options.store.webRows(scope);
        return send(res, 200, { rows });
      }

      return send(res, 404, { error: 'not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error';
      return send(res, 400, { error: message });
    }
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function handleSignals(store: Store, principal: Principal, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const contentType = req.headers['content-type'] ?? '';
  if (contentType.includes('protobuf')) {
    send(res, 415, { error: 'this spike accepts OTLP JSON only' });
    return;
  }
  const parsed = parseOtlp(await readJson(req));
  if (principal.role === 'tenant' && parsed.requests.some((request) => request.tenantId !== principal.tenantId)) {
    send(res, 403, { error: 'tenant.id does not match the token' });
    return;
  }
  let stored = 0;
  for (const request of parsed.requests) {
    await store.addApi({
      tenantId: request.tenantId,
      serviceName: request.serviceName,
      route: normalizePath(request.route),
      statusCode: request.statusCode,
      durationMs: request.durationMs,
    });
    stored += 1;
  }
  send(res, 200, {
    stored,
    droppedSpans: parsed.droppedSpans,
    droppedLogs: parsed.droppedLogs,
    retained: 'route, status, latency histogram',
  });
}

async function main(): Promise<void> {
  const { DEMO_ROSTER, seedDemo } = await import('./seed.ts');
  const operatorToken = process.env.OPERATOR_TOKEN ?? DEMO_ROSTER.operatorToken;
  const databaseUrl = process.env.DATABASE_URL;
  const store = databaseUrl ? await PgStore.connect(databaseUrl, operatorToken) : new MemoryStore(operatorToken);
  const demo = { ...DEMO_ROSTER, operatorToken };
  await seedDemo(store, demo);
  const server = await startServer({ port: Number(process.env.PORT ?? 8787), store, demo });
  console.log(`open ${server.url}`);
}

const isDirect = process.argv[1]?.endsWith('server.ts');
if (isDirect) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

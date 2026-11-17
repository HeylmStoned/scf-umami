export type UmamiEnv = {
  UMAMI_URL?: string;
  UMAMI_USER?: string;
  UMAMI_PASSWORD?: string;
  UMAMI_ALPHA?: string;
  UMAMI_BETA?: string;
};

const RANGES: Record<string, { period: string; unit: string }> = {
  '24h': { period: '24h', unit: 'hour' },
  '7d': { period: '7d', unit: 'day' },
  '30d': { period: '30d', unit: 'day' },
  '90d': { period: '90day', unit: 'day' },
};

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
let session: { token: string; until: number } | null = null;
const boards = new Map<string, { until: number; body: unknown }>();

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(current: number, previous: number): number {
  if (!previous) return 0;
  return (current - previous) / previous;
}

function title(value: string): string {
  if (!value) return 'Unknown';
  const first = value[0];
  if (first >= 'a' && first <= 'z') return first.toUpperCase() + value.slice(1);
  return value;
}

function place(code: string): string {
  if (!code) return 'Unknown';
  try {
    return regions.of(code) || code;
  } catch {
    return code;
  }
}

async function umami(env: UmamiEnv, path: string, token?: string): Promise<unknown> {
  const response = await fetch(env.UMAMI_URL + path, {
    headers: token ? { authorization: 'Bearer ' + token } : { 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error('Umami ' + response.status);
  return response.json();
}

async function tokenFor(env: UmamiEnv): Promise<string> {
  if (session && session.until > Date.now()) return session.token;
  const response = await fetch(env.UMAMI_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: env.UMAMI_USER || 'admin', password: env.UMAMI_PASSWORD }),
  });
  if (!response.ok) throw new Error('Umami login failed');
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error('Umami login failed');
  session = { token: body.token, until: Date.now() + 10 * 60 * 1000 };
  return body.token;
}

function rows(data: unknown, kind: string): { name: string; count: number }[] {
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const item = row as { x?: string; y?: number };
    const raw = item.x || '';
    const name = kind === 'country' ? place(raw) : kind === 'referrer' ? (raw || 'Direct') : kind === 'path' ? (raw || '/') : title(raw);
    return { name, count: num(item.y) };
  });
}

function stamp(value: string, unit: string): { label: string; when: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: value, when: value };
  if (unit === 'hour') {
    const label = date.toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' });
    const when = date.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
    return { label, when };
  }
  const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const when = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return { label, when };
}

export async function umamiDashboard(env: UmamiEnv, range: string): Promise<unknown | null> {
  if (!env.UMAMI_URL || !env.UMAMI_PASSWORD || !env.UMAMI_ALPHA || !env.UMAMI_BETA) return null;
  const spec = RANGES[range] ?? RANGES['30d'];
  const key = spec.period;
  const hit = boards.get(key);
  if (hit && hit.until > Date.now()) return hit.body;
  const token = await tokenFor(env);
  const query = 'period=' + spec.period + '&timezone=UTC';
  const projects = await Promise.all([
    project(env, token, 'alpha', env.UMAMI_ALPHA, query, spec.unit),
    project(env, token, 'beta', env.UMAMI_BETA, query, spec.unit),
  ]);
  const body = { source: 'umami', range, projects: Object.fromEntries(projects) };
  boards.set(key, { until: Date.now() + 60_000, body });
  return body;
}

async function project(env: UmamiEnv, token: string, id: string, websiteId: string, query: string, unit: string): Promise<[string, unknown]> {
  const root = '/api/websites/' + websiteId;
  const [stats, series, paths, referrers, countries, browsers, devices, systems] = await Promise.all([
    umami(env, root + '/stats?' + query, token),
    umami(env, root + '/pageviews?' + query + '&unit=' + unit, token),
    umami(env, root + '/metrics?' + query + '&type=path&limit=8', token),
    umami(env, root + '/metrics?' + query + '&type=referrer&limit=8', token),
    umami(env, root + '/metrics?' + query + '&type=country&limit=8', token),
    umami(env, root + '/metrics?' + query + '&type=browser&limit=8', token),
    umami(env, root + '/metrics?' + query + '&type=device&limit=8', token),
    umami(env, root + '/metrics?' + query + '&type=os&limit=8', token),
  ]);
  const current = stats as { pageviews?: number; visitors?: number; visits?: number; bounces?: number; totaltime?: number; comparison?: { pageviews?: number; visitors?: number; bounces?: number; visits?: number; totaltime?: number } };
  const visits = num(current.visits);
  const bounces = num(current.bounces);
  const bounce = visits ? bounces / visits : 0;
  const previousVisits = num(current.comparison?.visits);
  const previousBounces = num(current.comparison?.bounces);
  const previousBounce = previousVisits ? previousBounces / previousVisits : 0;
  const duration = visits > bounces ? num(current.totaltime) / (visits - bounces) : 0;
  const previousDuration = previousVisits > previousBounces ? num(current.comparison?.totaltime) / (previousVisits - previousBounces) : 0;
  const pageviews = (series as { pageviews?: { x: string; y: number }[] }).pageviews || [];
  const sessions = (series as { sessions?: { x: string; y: number }[] }).sessions || [];
  const visitorsByDay = new Map(sessions.map((point) => [point.x, num(point.y)]));
  const marks = pageviews.map((point) => stamp(point.x, unit));
  return [id, {
    views: num(current.pageviews),
    visitors: num(current.visitors),
    bounce,
    duration,
    pages: rows(paths, 'path').map((row) => ({ path: row.name === 'Unknown' ? '/' : row.name, views: row.count, visitors: row.count, tenantId: id })),
    seriesViews: pageviews.map((point) => num(point.y)),
    seriesVisitors: pageviews.map((point) => visitorsByDay.get(point.x) || 0),
    labels: marks.map((mark) => mark.label),
    when: marks.map((mark) => mark.when),
    referrers: rows(referrers, 'referrer'),
    countries: rows(countries, 'country'),
    browsers: rows(browsers, 'browser'),
    devices: rows(devices, 'device'),
    os: rows(systems, 'os'),
    delta: {
      pageviews: ratio(num(current.pageviews), num(current.comparison?.pageviews)),
      visitors: ratio(num(current.visitors), num(current.comparison?.visitors)),
      bounce: ratio(bounce, previousBounce),
      duration: ratio(duration, previousDuration),
    },
  }];
}

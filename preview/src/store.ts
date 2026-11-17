import { createHash, randomBytes } from 'node:crypto';
import { bucketIndex, emptyCounts, percentile } from './histogram.ts';

export type ApiRow = {
  tenantId: string;
  serviceName: string;
  route: string;
  statusCode: number;
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type WebRow = {
  tenantId: string;
  path: string;
  views: number;
};

export type Principal = { role: 'operator' } | { role: 'tenant'; tenantId: string };

type ApiKey = {
  tenantId: string;
  serviceName: string;
  route: string;
  statusCode: number;
  hour: string;
  counts: number[];
};

export function hourKey(date = new Date()): string {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy.toISOString();
}

export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(24).toString('hex');
}

export class MemoryStore {
  private readonly tokens = new Map<string, Principal>();
  private readonly api = new Map<string, ApiKey>();
  private readonly web = new Map<string, number>();

  constructor(operatorToken: string) {
    this.tokens.set(hashToken(operatorToken), { role: 'operator' });
  }

  principal(token: string | undefined): Principal | undefined {
    if (!token) return undefined;
    return this.tokens.get(hashToken(token));
  }

  addTenant(id: string, token = newToken()): string {
    this.tokens.set(hashToken(token), { role: 'tenant', tenantId: id });
    return token;
  }

  addApi(row: { tenantId: string; serviceName: string; route: string; statusCode: number; durationMs: number }, at = new Date()): void {
    const hour = hourKey(at);
    const key = [row.tenantId, row.serviceName, row.route, row.statusCode, hour].join('|');
    const existing = this.api.get(key) ?? {
      tenantId: row.tenantId,
      serviceName: row.serviceName,
      route: row.route,
      statusCode: row.statusCode,
      hour,
      counts: emptyCounts(),
    };
    const index = bucketIndex(row.durationMs);
    existing.counts[index] = (existing.counts[index] ?? 0) + 1;
    this.api.set(key, existing);
  }

  addPageview(tenantId: string, path: string): void {
    const key = `${tenantId}|${dayKey()}|${path}`;
    this.web.set(key, (this.web.get(key) ?? 0) + 1);
  }

  apiRows(tenantId?: string): ApiRow[] {
    const grouped = new Map<string, { row: Omit<ApiRow, 'count' | 'p50Ms' | 'p95Ms'>; counts: number[] }>();
    for (const entry of this.api.values()) {
      if (tenantId && entry.tenantId !== tenantId) continue;
      const key = [entry.tenantId, entry.serviceName, entry.route, entry.statusCode].join('|');
      const existing = grouped.get(key) ?? {
        row: {
          tenantId: entry.tenantId,
          serviceName: entry.serviceName,
          route: entry.route,
          statusCode: entry.statusCode,
        },
        counts: emptyCounts(),
      };
      existing.counts = existing.counts.map((count, index) => count + (entry.counts[index] ?? 0));
      grouped.set(key, existing);
    }
    return [...grouped.values()].map(({ row, counts }) => ({
      ...row,
      count: counts.reduce((sum, count) => sum + count, 0),
      p50Ms: percentile(counts, 50),
      p95Ms: percentile(counts, 95),
    }));
  }

  webRows(tenantId?: string): WebRow[] {
    const rows: WebRow[] = [];
    for (const [key, views] of this.web) {
      const [owner, , path] = key.split('|');
      if (!owner || path === undefined) continue;
      if (tenantId && owner !== tenantId) continue;
      rows.push({ tenantId: owner, path, views });
    }
    return rows;
  }
}

export type Store = {
  principal(token: string | undefined): Promise<Principal | undefined> | Principal | undefined;
  addTenant(id: string, token?: string): Promise<string> | string;
  addApi(row: { tenantId: string; serviceName: string; route: string; statusCode: number; durationMs: number }, at?: Date): Promise<void> | void;
  addPageview(tenantId: string, path: string): Promise<void> | void;
  apiRows(tenantId?: string): Promise<ApiRow[]> | ApiRow[];
  webRows(tenantId?: string): Promise<WebRow[]> | WebRow[];
};

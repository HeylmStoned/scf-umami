export type ExtractedRequest = {
  tenantId: string;
  serviceName: string;
  route: string;
  statusCode: number;
  durationMs: number;
};

export type IngestParse = {
  requests: ExtractedRequest[];
  droppedSpans: number;
  droppedLogs: number;
};

type Attr = { key?: string; value?: Record<string, unknown> };

function attrValue(value: Record<string, unknown> | undefined): string | number | undefined {
  if (!value) return undefined;
  if (typeof value.stringValue === 'string') return value.stringValue;
  if (typeof value.intValue === 'number' || typeof value.intValue === 'string') return Number(value.intValue);
  if (typeof value.doubleValue === 'number') return value.doubleValue;
  return undefined;
}

function attrMap(list: unknown): Map<string, string | number> {
  const map = new Map<string, string | number>();
  if (!Array.isArray(list)) return map;
  for (const entry of list as Attr[]) {
    if (!entry?.key) continue;
    const value = attrValue(entry.value);
    if (value !== undefined && !Number.isNaN(value)) map.set(entry.key, value);
  }
  return map;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function nanoDiffMs(start: unknown, end: unknown): number | undefined {
  if (typeof start !== 'string' && typeof start !== 'number') return undefined;
  if (typeof end !== 'string' && typeof end !== 'number') return undefined;
  const delta = Number(end) - Number(start);
  if (!Number.isFinite(delta) || delta < 0) return undefined;
  return delta / 1_000_000;
}

function routeOf(attributes: Map<string, string | number>, spanName: unknown): string {
  const route = attributes.get('http.route') ?? attributes.get('http.target') ?? attributes.get('url.path');
  if (typeof route === 'string' && route.length > 0) return route;
  return typeof spanName === 'string' && spanName.startsWith('/') ? spanName : '/';
}

function statusOf(attributes: Map<string, string | number>): number {
  const status = attributes.get('http.response.status_code') ?? attributes.get('http.status_code');
  const code = typeof status === 'number' ? status : Number(status);
  return Number.isInteger(code) && code >= 100 && code <= 599 ? code : 0;
}

/**
 * Read the fields the RFP keeps, then forget the span and the log.
 * The returned objects do not carry trace ids, span ids, or log bodies.
 */
export function parseOtlp(body: unknown): IngestParse {
  const root = asRecord(body) ?? {};
  const requests: ExtractedRequest[] = [];
  let droppedSpans = 0;
  let droppedLogs = 0;

  const resourceSpans = Array.isArray(root.resourceSpans) ? root.resourceSpans : [];
  for (const resourceSpan of resourceSpans) {
    const wrapper = asRecord(resourceSpan);
    const resource = attrMap(asRecord(wrapper?.resource)?.attributes);
    const tenantId = resource.get('tenant.id');
    const serviceName = resource.get('service.name');
    const scopeSpans = Array.isArray(wrapper?.scopeSpans) ? wrapper.scopeSpans : [];
    for (const scope of scopeSpans) {
      const spans = Array.isArray(asRecord(scope)?.spans) ? (asRecord(scope)?.spans as unknown[]) : [];
      for (const span of spans) {
        droppedSpans += 1;
        if (typeof tenantId !== 'string' || typeof serviceName !== 'string') continue;
        const record = asRecord(span);
        const attributes = attrMap(record?.attributes);
        const durationMs = nanoDiffMs(record?.startTimeUnixNano, record?.endTimeUnixNano);
        if (durationMs === undefined) continue;
        requests.push({
          tenantId,
          serviceName,
          route: routeOf(attributes, record?.name),
          statusCode: statusOf(attributes),
          durationMs,
        });
      }
    }
  }

  const resourceLogs = Array.isArray(root.resourceLogs) ? root.resourceLogs : [];
  for (const resourceLog of resourceLogs) {
    const scopes = Array.isArray(asRecord(resourceLog)?.scopeLogs) ? (asRecord(resourceLog)?.scopeLogs as unknown[]) : [];
    for (const scope of scopes) {
      const records = asRecord(scope)?.logRecords;
      if (Array.isArray(records)) droppedLogs += records.length;
    }
  }

  return { requests, droppedSpans, droppedLogs };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOtlp } from './otlp.ts';

test('keeps route, status, and latency and drops the log body', () => {
  const secret = 'wallet-seed-do-not-store';
  const parsed = parseOtlp({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'tenant.id', value: { stringValue: 'prism' } },
            { key: 'service.name', value: { stringValue: 'api' } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'abc',
                spanId: 'def',
                name: 'GET',
                startTimeUnixNano: '0',
                endTimeUnixNano: '30000000',
                attributes: [
                  { key: 'http.route', value: { stringValue: '/accounts/GA' } },
                  { key: 'http.response.status_code', value: { intValue: '200' } },
                ],
              },
            ],
          },
        ],
      },
    ],
    resourceLogs: [
      {
        scopeLogs: [{ logRecords: [{ body: { stringValue: secret } }] }],
      },
    ],
  });

  assert.equal(parsed.droppedSpans, 1);
  assert.equal(parsed.droppedLogs, 1);
  assert.equal(parsed.requests.length, 1);
  assert.equal(parsed.requests[0]?.tenantId, 'prism');
  assert.equal(parsed.requests[0]?.statusCode, 200);
  assert.equal(parsed.requests[0]?.durationMs, 30);
  assert.equal(JSON.stringify(parsed).includes(secret), false);
  assert.equal(JSON.stringify(parsed).includes('traceId'), false);
});

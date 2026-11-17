import { normalizePath } from './normalize.ts';
import type { Store } from './store.ts';

export type DemoRoster = {
  operatorToken: string;
  tenants: { id: string; token: string }[];
};

export const DEMO_ROSTER: DemoRoster = {
  operatorToken: 'operator-dev-token',
  tenants: [
    { id: 'alpha', token: 'alpha-dev-token' },
    { id: 'beta', token: 'beta-dev-token' },
  ],
};

const account = `G${'A'.repeat(55)}`;
const contract = `C${'A'.repeat(55)}`;

async function repeat(times: number, run: () => Promise<void>): Promise<void> {
  for (let index = 0; index < times; index += 1) await run();
}

export async function seedDemo(store: Store, roster: DemoRoster = DEMO_ROSTER): Promise<void> {
  for (const tenant of roster.tenants) await store.addTenant(tenant.id, tenant.token);
  if ((await store.apiRows()).length > 0) return;

  const payment = normalizePath(`/accounts/${account}/payments/42/`);
  const accountPath = normalizePath(`/accounts/${account}/`);
  const contractPath = normalizePath(`/contracts/${contract}`);

  await repeat(48, () => store.addPageview('alpha', '/'));
  await repeat(22, () => store.addPageview('alpha', '/swap'));
  await repeat(14, () => store.addPageview('alpha', accountPath));
  await repeat(9, () => store.addPageview('alpha', '/markets/usdc'));
  await repeat(4, () => store.addPageview('alpha', '/docs'));

  await repeat(31, () => store.addPageview('beta', '/'));
  await repeat(18, () => store.addPageview('beta', '/markets/usdc'));
  await repeat(11, () => store.addPageview('beta', '/trade'));
  await repeat(6, () => store.addPageview('beta', contractPath));

  const hit = (tenantId: string, serviceName: string, route: string, statusCode: number, durationMs: number, times: number) =>
    repeat(times, () => store.addApi({ tenantId, serviceName, route, statusCode, durationMs }));

  await hit('alpha', 'payments', payment, 200, 40, 16);
  await hit('alpha', 'payments', payment, 200, 180, 3);
  await hit('alpha', 'payments', payment, 200, 700, 1);
  await hit('alpha', 'payments', payment, 201, 90, 4);
  await hit('alpha', 'payments', payment, 404, 12, 2);
  await hit('alpha', 'rpc', contractPath, 200, 55, 11);
  await hit('alpha', 'rpc', contractPath, 500, 900, 1);

  await hit('beta', 'quotes', '/markets/usdc', 200, 20, 14);
  await hit('beta', 'quotes', '/markets/usdc', 200, 140, 2);
  await hit('beta', 'payments', payment, 200, 70, 6);
  await hit('beta', 'payments', payment, 500, 800, 3);
}

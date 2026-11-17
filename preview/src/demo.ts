import { spawn } from 'node:child_process';
import { DEMO_ROSTER, seedDemo } from './seed.ts';
import { startServer } from './server.ts';
import { MemoryStore } from './store.ts';

async function main(): Promise<void> {
  const store = new MemoryStore(DEMO_ROSTER.operatorToken);
  await seedDemo(store);
  const server = await startServer({ port: 8787, store, demo: DEMO_ROSTER });
  console.log(`open ${server.url}`);
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', server.url], { detached: true, stdio: 'ignore' }).unref();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

import { loadConfig } from './config.mjs';
import { Quota } from './quota.mjs';
import { createRelayServer } from './server.mjs';

try {
  const config = loadConfig();
  const quota = new Quota(config.databasePath, config.limits);
  const relay = createRelayServer({ config, quota });
  relay.server.on('error', () => { console.error('Review relay could not start.'); process.exitCode = 1; quota.close(); });
  relay.server.listen(config.port, config.host, () => console.info('Review relay listening. HTTPS reverse proxy required.'));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await relay.close(); quota.close();
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
} catch {
  console.error('Review relay disabled: configuration or persistent quota storage unavailable.');
  process.exitCode = 1;
}

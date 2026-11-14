import { logger } from './logger.js';
import { createRealtimeServer } from './server.js';

async function main(): Promise<void> {
  const handle = createRealtimeServer();
  await handle.listen();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down NOVA realtime server');
    try {
      await handle.destroy();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error while shutting down NOVA realtime server');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main();

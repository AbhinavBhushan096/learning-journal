import { createApp } from './app.js';
import { config } from './config.js';

const { server, db } = await createApp();
server.listen(config.port, '0.0.0.0', () => {
  console.log(`\nLearning Journal running at http://localhost:${config.port}`);
  if (!config.isProduction && !process.env.ADMIN_PASSWORD) {
    console.log('Development owner login: owner@example.com / learning-journal-dev');
  }
});

function shutdown(signal) {
  console.log(`\n${signal} received; closing cleanly.`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', error => { console.error('Uncaught exception', error); shutdown('uncaughtException'); });
process.on('unhandledRejection', error => { console.error('Unhandled rejection', error); });

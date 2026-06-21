import { runEngine } from './engine.js';

// One-shot entry point (used by GitHub Actions cron and `npm start`).
runEngine()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    console.error(`[Fatal] Unhandled: ${error.message}`);
    process.exit(1);
  });

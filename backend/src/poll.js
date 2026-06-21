import { runEngine } from './engine.js';

// Always-on poller for true 1-2 minute checking (GitHub Actions can't go below
// ~5 min). Run this on any machine that stays on:  npm run poll
//
// Interval is configurable via POLL_INTERVAL_SECONDS (default 90s). Runs are
// sequential — the next run starts only after the previous one finishes — so
// they never overlap even if a fetch is slow.

const intervalSeconds = Math.max(
  30,
  parseInt(process.env.POLL_INTERVAL_SECONDS || '90', 10) || 90
);

let stopping = false;

async function loop() {
  console.log(`\n[Poll] Job Alert poller started — every ${intervalSeconds}s`);
  while (!stopping) {
    const startedAt = Date.now();
    try {
      await runEngine();
    } catch (error) {
      console.error(`[Poll] Run crashed: ${error.message}`);
    }
    if (stopping) break;
    const elapsed = (Date.now() - startedAt) / 1000;
    const wait = Math.max(0, intervalSeconds - elapsed);
    console.log(`[Poll] Next run in ${wait.toFixed(0)}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  console.log('[Poll] Stopped.');
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[Poll] ${sig} received — finishing current run then exiting...`);
    stopping = true;
  });
}

loop();

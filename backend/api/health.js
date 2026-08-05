/**
 * GET /api/health — liveness + last cron run summary.
 * Unauthenticated so an external uptime monitor can poll it.
 */

import { withApi } from '../src/http/apiKit.js';
import { getFirestore } from '../src/firebase/admin.js';
import { getEnabledSources } from '../src/sources/registry.js';

export default withApi({ methods: ['GET'], auth: false }, async () => {
  let lastRun = null;
  let firestoreOk = true;

  try {
    const snapshot = await getFirestore().doc('cron_status/latest').get();
    if (snapshot.exists) {
      const data = snapshot.data();
      lastRun = {
        at: data.lastRunAt ?? null,
        status: data.status ?? 'unknown',
        durationSeconds: data.durationSeconds ?? null,
        newJobs: data.ingest?.newJobs ?? 0,
        notificationsSent: data.personalization?.notificationsSent ?? 0,
      };
    }
  } catch {
    firestoreOk = false;
  }

  const staleAfterMs = 15 * 60 * 1000;
  const isStale = lastRun?.at ? Date.now() - new Date(lastRun.at).getTime() > staleAfterMs : true;

  return {
    service: 'job-alert-backend',
    firestore: firestoreOk ? 'ok' : 'unreachable',
    enabledSources: getEnabledSources().map((source) => source.id),
    lastRun,
    isStale,
    now: new Date().toISOString(),
  };
});

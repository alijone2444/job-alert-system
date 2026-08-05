/**
 * Push notifications — now TARGETED PER USER.
 *
 * The old behaviour multicast every job to every registered device, which is
 * the exact thing personalisation exists to stop. Now a device only receives a
 * job that scored above THAT user's own notify threshold.
 *
 * Two further anti-spam rules, because a 2-minute cron makes it very easy to
 * become a nuisance:
 *
 *  - MAX_PER_RUN caps how many notifications one user can receive per cycle.
 *    Ten alerts at once do not get read; they get the app muted.
 *  - When more than one job qualifies, we send a single SUMMARY notification
 *    instead of N separate ones.
 */

import { getMessaging } from '../firebase/admin.js';
import { createLogger } from '../core/logger.js';
import { clearInvalidTokens } from '../repositories/usersRepo.js';

const log = createLogger('Push');

/** More than this in one cycle becomes noise, so we summarise instead. */
const MAX_INDIVIDUAL_PER_RUN = 3;

const SOURCE_COLOR = {
  linkedin: '#0A66C2',
  greenhouse: '#24A47F',
  lever: '#5C6AC4',
  ashby: '#7C3AED',
  remoteok: '#FF4742',
  weworkremotely: '#1F6FEB',
  rozee: '#0B7A3B',
};

const DEAD_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

function buildMessage(token, { title, body, data, color }) {
  return {
    token,
    notification: { title, body },
    data,
    android: {
      priority: 'high',
      notification: {
        channelId: 'job_alerts',
        priority: 'high',
        defaultSound: true,
        color: color || '#1A73E8',
      },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: { aps: { alert: { title, body }, sound: 'default', 'content-available': 1 } },
    },
  };
}

/**
 * Notify ONE user about the jobs that matched them this run.
 *
 * @param {string} userId
 * @param {string} token
 * @param {Array<{job:Object, result:Object}>} matches  already threshold-filtered
 * @returns {Promise<{sent:number, deadToken:boolean}>}
 */
export async function notifyUser(userId, token, matches) {
  if (!token || !matches.length) return { sent: 0, deadToken: false };

  const messaging = getMessaging();
  const ranked = [...matches].sort((a, b) => b.result.score - a.result.score);
  const messages = [];

  if (ranked.length <= MAX_INDIVIDUAL_PER_RUN) {
    for (const { job, result } of ranked) {
      messages.push(
        buildMessage(token, {
          title: `${result.score}% match · ${sourceLabel(job)}`,
          body: `${job.title}${job.company ? ` — ${job.company}` : ''}`,
          color: SOURCE_COLOR[job.sourceId],
          data: {
            type: 'job',
            jobKey: job.jobKey,
            score: String(result.score),
            title: job.title,
            company: job.company || '',
            location: job.location || '',
            source: job.sourceId,
            // The app opens THIS url — we never replicate the apply flow.
            applyUrl: job.applyUrl,
          },
        })
      );
    }
  } else {
    const top = ranked[0];
    messages.push(
      buildMessage(token, {
        title: `${ranked.length} new matches for you`,
        body: `Top: ${top.job.title} (${top.result.score}%)`,
        color: SOURCE_COLOR[top.job.sourceId],
        data: {
          type: 'digest',
          count: String(ranked.length),
          jobKey: top.job.jobKey,
          applyUrl: top.job.applyUrl,
          score: String(top.result.score),
        },
      })
    );
  }

  let sent = 0;
  let deadToken = false;

  for (const message of messages) {
    try {
      await messaging.send(message);
      sent++;
    } catch (error) {
      if (DEAD_TOKEN_CODES.has(error.code)) {
        deadToken = true;
        log.warn('dead token', { userId, code: error.code });
        break; // no point trying the rest with the same token
      }
      log.error('send failed', { userId, error: error.message });
    }
  }

  return { sent, deadToken };
}

/**
 * Notify many users, cleaning up dead tokens as a side effect.
 * @param {Array<{userId:string, token:string, matches:Array}>} deliveries
 */
export async function notifyUsers(deliveries) {
  const dead = [];
  let sent = 0;

  for (const delivery of deliveries) {
    const result = await notifyUser(delivery.userId, delivery.token, delivery.matches);
    sent += result.sent;
    if (result.deadToken) dead.push(delivery.userId);
  }

  if (dead.length) await clearInvalidTokens(dead);
  if (sent) log.info('notifications sent', { sent, users: deliveries.length, deadTokens: dead.length });

  return { sent, deadTokens: dead.length };
}

function sourceLabel(job) {
  return (
    { linkedin: 'LinkedIn', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', remoteok: 'RemoteOK', weworkremotely: 'WWR', rozee: 'Rozee' }[
      job.sourceId
    ] || job.sourceId
  );
}

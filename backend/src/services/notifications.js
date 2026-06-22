import { getMessaging } from '../firebase/admin.js';
import { removeInvalidTokens } from './firestore.js';

// Accent color per source (shows on the Android notification + small icon).
const PLATFORM_COLOR = {
  LinkedIn: '#0A66C2', // LinkedIn blue
  Remote: '#14A800', // green — visually distinct from LinkedIn
  Upwork: '#14A800',
};

/**
 * Send a high-priority FCM notification to all registered devices.
 * @param {string[]} tokens
 * @param {object} job
 * @returns {Promise<{successCount: number, failureCount: number}>}
 */
export async function sendJobAlert(tokens, job) {
  if (!tokens.length) {
    console.warn('[FCM] No device tokens to notify');
    return { successCount: 0, failureCount: 0 };
  }

  const messaging = getMessaging();
  const invalidTokens = [];
  let successCount = 0;
  let failureCount = 0;

  // FCM multicast supports up to 500 tokens per request
  const chunkSize = 500;

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);

    const message = {
      tokens: chunk,
      notification: {
        title: `New ${job.platform} Job`,
        body: job.title,
      },
      data: {
        jobId: job.id,
        platform: job.platform,
        title: job.title,
        link: job.link,
        company: job.company || '',
        location: job.location || '',
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'job_alerts',
          priority: 'high',
          defaultSound: true,
          color: PLATFORM_COLOR[job.platform] || '#1A73E8',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            alert: {
              title: `New ${job.platform} Job`,
              body: job.title,
            },
            sound: 'default',
            'content-available': 1,
          },
        },
      },
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      successCount += response.successCount;
      failureCount += response.failureCount;

      response.responses.forEach((res, index) => {
        if (!res.success) {
          const code = res.error?.code;
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(chunk[index]);
          }
          console.warn(`[FCM] Token delivery failed: ${res.error?.message}`);
        }
      });
    } catch (error) {
      failureCount += chunk.length;
      console.error(`[FCM] Multicast send error: ${error.message}`);
    }
  }

  if (invalidTokens.length) {
    await removeInvalidTokens(invalidTokens);
  }

  console.log(`[FCM] Sent alerts for "${job.title}" — success: ${successCount}, failed: ${failureCount}`);
  return { successCount, failureCount };
}

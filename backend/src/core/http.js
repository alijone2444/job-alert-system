/**
 * HTTP helpers shared by every source adapter.
 *
 * WHY centralised: adapters must not each re-invent timeouts, retries and
 * user-agents. A single adapter that hangs without a timeout would blow the
 * whole serverless invocation budget and the cron run would return nothing —
 * exactly the failure mode this system cannot afford.
 */

import { createLogger } from './logger.js';

const log = createLogger('Http');

export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 12_000;

/** Statuses worth retrying — transient server/network problems only. */
const RETRYABLE = new Set([408, 425, 500, 502, 503, 504]);

export class HttpError extends Error {
  constructor(status, url, body = '') {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body.slice(0, 300);
  }
}

/**
 * Fetch with timeout + bounded retry with backoff.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {Object} [options.headers]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retries]   attempts after the first (default 1)
 * @returns {Promise<Response>}
 */
export async function httpGet(url, options = {}) {
  const { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1 } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': DESKTOP_USER_AGENT,
          'Accept-Language': 'en-US,en;q=0.9',
          ...headers,
        },
      });

      if (!response.ok) {
        // 429 must NOT be retried — retrying a rate limit deepens the ban.
        if (response.status === 429) throw new HttpError(429, url);
        if (RETRYABLE.has(response.status) && attempt < retries) {
          lastError = new HttpError(response.status, url);
          await delay(400 * (attempt + 1));
          continue;
        }
        throw new HttpError(response.status, url, await safeText(response));
      }

      return response;
    } catch (error) {
      lastError = error;
      const isAbort = error.name === 'AbortError';
      const isRateLimit = error instanceof HttpError && error.status === 429;
      if (isRateLimit || attempt >= retries) break;
      log.debug(`retry ${attempt + 1} for ${url}`, { reason: isAbort ? 'timeout' : error.message });
      await delay(400 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`Request failed: ${url}`);
}

/** GET + parse JSON. */
export async function getJson(url, options = {}) {
  const response = await httpGet(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  return response.json();
}

/** GET + read text (HTML/RSS). */
export async function getText(url, options = {}) {
  const response = await httpGet(url, options);
  return response.text();
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A wall-clock budget guard.
 *
 * WHY: Vercel kills the function at its maxDuration with no chance to persist
 * anything, so partial work is lost AND the cron looks dead. Every long loop in
 * this codebase checks `budget.expired()` and stops cleanly, letting the next
 * 2-minute run continue where this one left off.
 */
export function createBudget(totalMs) {
  const startedAt = Date.now();
  return {
    startedAt,
    elapsedMs: () => Date.now() - startedAt,
    remainingMs: () => Math.max(0, totalMs - (Date.now() - startedAt)),
    expired: (reserveMs = 0) => Date.now() - startedAt >= totalMs - reserveMs,
  };
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

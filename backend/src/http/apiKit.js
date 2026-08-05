/**
 * Shared plumbing for every HTTP handler: bootstrap, auth, CORS, body parsing
 * and error mapping.
 *
 * WHY a wrapper instead of repeating this in each handler: on Vercel every file
 * under api/ is an independent function with its own cold start. Without a
 * shared bootstrap, one handler forgetting `initFirebase()` fails at runtime in
 * production only. `withApi()` makes that impossible to forget.
 */

import admin from 'firebase-admin';
import { loadConfig } from '../config.js';
import { initFirebase } from '../firebase/admin.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('Api');

let bootstrapped = false;

/** Initialise Firebase once per warm container. */
function bootstrap() {
  if (bootstrapped) return;
  const config = loadConfig();
  initFirebase(config.firebaseServiceAccount);
  bootstrapped = true;
}

export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, message, details);
export const unauthorized = (message = 'unauthorized') => new ApiError(401, message);
export const forbidden = (message = 'forbidden') => new ApiError(403, message);
export const notFound = (message = 'not found') => new ApiError(404, message);

/**
 * Legacy device ids, from before accounts existed.
 *
 * A Firebase uid is a 28-character opaque string and never has this shape, so
 * the two identity spaces cannot collide — which is what lets both work during
 * the migration without a signed-in account ever being reachable without a
 * token.
 */
export const LEGACY_DEVICE_ID = /^(android|ios)_[A-Za-z0-9_-]+$/;

/** Set ALLOW_LEGACY_DEVICE_AUTH=false once every install has signed in. */
const allowLegacy = (process.env.ALLOW_LEGACY_DEVICE_AUTH ?? 'true').toLowerCase() !== 'false';

function appKeyMatches(req) {
  const expected = process.env.APP_API_KEY || process.env.RUN_SECRET;
  if (!expected) return true; // unset = open, for local development
  const provided =
    req.headers['x-app-key'] || req.headers['x-run-key'] || (req.query && req.query.key);
  return provided === expected;
}

/**
 * Verify the caller and resolve WHO they are.
 *
 * The real credential is a Firebase ID token: a client cannot forge one, and
 * the uid inside it is the identity — so `userId` is never read from the
 * request body. That is the entire point of moving off device ids; trusting a
 * client-supplied user id would have preserved the same hole under a new name.
 *
 * @returns {Promise<{uid: string|null, legacy: boolean}>}
 */
async function authorize(req, mode) {
  if (mode === false) return { uid: null, legacy: false };

  if (!appKeyMatches(req)) throw unauthorized('invalid app key');
  if (mode === 'appKey') return { uid: null, legacy: false };

  // mode === 'user'
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (token) {
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      return { uid: decoded.uid, legacy: false };
    } catch (error) {
      log.warn('ID token rejected', { error: error.message });
      throw unauthorized('invalid or expired session');
    }
  }

  // --- transition path -----------------------------------------------------
  // An install from before sign-in existed has no token. It may still act on
  // its OWN device-shaped id, guarded by the app key. Accounts (uid-shaped ids)
  // are never reachable this way.
  if (allowLegacy) {
    const claimed = String(req.body?.userId || req.query?.userId || '').trim();
    if (LEGACY_DEVICE_ID.test(claimed)) {
      log.info('legacy device auth', { userId: claimed });
      return { uid: claimed, legacy: true };
    }
  }

  throw unauthorized('sign-in required');
}

/** Vercel parses JSON bodies, but be defensive about strings and empties. */
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw badRequest('body must be valid JSON');
    }
  }
  return req.body;
}

/**
 * Wrap a handler with bootstrap, method checking, auth, CORS and error mapping.
 *
 * @param {Object} options
 * @param {string[]} options.methods              Allowed HTTP methods.
 * @param {'user'|'appKey'|false} [options.auth]  Identity requirement.
 *        'user'   (default) a verified Firebase ID token — ctx.uid is set
 *        'appKey' shared key only, no identity (e.g. the source registry)
 *        false    fully open (taxonomy, health)
 * @param {(ctx) => Promise<any>} handler  Returns the JSON payload.
 */
export function withApi({ methods = ['GET'], auth = 'user' }, handler) {
  return async function route(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-App-Key, X-Run-Key'
    );
    res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const startedAt = Date.now();

    try {
      if (!methods.includes(req.method)) {
        throw new ApiError(405, `method ${req.method} not allowed`);
      }

      // Must precede authorize() — verifying an ID token needs the Admin SDK.
      bootstrap();
      const identity = await authorize(req, auth);

      const payload = await handler({
        req,
        res,
        query: req.query || {},
        body: parseBody(req),
        uid: identity.uid,
        isLegacyDevice: identity.legacy,
      });

      // A handler that wrote the response itself returns undefined.
      if (payload === undefined) return;

      res.status(200).json({ ok: true, ...payload });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      if (status >= 500) {
        log.error('handler failed', { path: req.url, error: error.message });
        if (error.stack) console.error(error.stack);
      } else {
        log.warn('request rejected', { path: req.url, status, error: error.message });
      }

      res.status(status).json({
        ok: false,
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    } finally {
      log.debug('request', { path: req.url, ms: Date.now() - startedAt });
    }
  };
}

/**
 * The authenticated user id.
 *
 * Comes from the verified token, NOT from the request — a client can ask for
 * anything, so anything a client asks for is not an identity.
 */
export function requireUserId(ctx) {
  if (!ctx.uid) throw unauthorized('sign-in required');
  return ctx.uid;
}

export function parseIntParam(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

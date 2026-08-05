/**
 * Shared plumbing for every HTTP handler: bootstrap, auth, CORS, body parsing
 * and error mapping.
 *
 * WHY a wrapper instead of repeating this in each handler: on Vercel every file
 * under api/ is an independent function with its own cold start. Without a
 * shared bootstrap, one handler forgetting `initFirebase()` fails at runtime in
 * production only. `withApi()` makes that impossible to forget.
 */

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
export const notFound = (message = 'not found') => new ApiError(404, message);

/**
 * Verify the caller.
 *
 * There is no user authentication in this system yet — a "user" is a device id.
 * A shared app key stops the write endpoints from being an open door on the
 * public internet, which is the realistic threat at this stage. When Firebase
 * Auth lands, this is the single function that changes: verify an ID token and
 * derive `userId` from it instead of trusting the request body.
 */
function authorize(req) {
  const expected = process.env.APP_API_KEY || process.env.RUN_SECRET;
  if (!expected) return; // unset = open, for local development

  const provided =
    req.headers['x-app-key'] || req.headers['x-run-key'] || (req.query && req.query.key);
  if (provided !== expected) throw unauthorized();
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
 * @param {string[]} options.methods    Allowed HTTP methods.
 * @param {boolean}  [options.auth]     Require the app key (default true).
 * @param {(ctx) => Promise<any>} handler  Returns the JSON payload.
 */
export function withApi({ methods = ['GET'], auth = true }, handler) {
  return async function route(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Key, X-Run-Key');
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
      if (auth) authorize(req);

      bootstrap();

      const payload = await handler({
        req,
        res,
        query: req.query || {},
        body: parseBody(req),
      });

      // A handler that wrote the response itself (e.g. a redirect) returns
      // undefined — do not double-send.
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
 * Extract and validate the target user id.
 * Today this trusts the client; see `authorize()` for the auth migration note.
 */
export function requireUserId({ query, body }) {
  const userId = String(body?.userId || query?.userId || '').trim();
  if (!userId || userId.length > 200) throw badRequest('userId is required');
  return userId;
}

export function parseIntParam(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

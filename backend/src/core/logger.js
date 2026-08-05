/**
 * Minimal structured logger.
 *
 * WHY not console.log everywhere: on Vercel every run is a separate invocation
 * and the only debugging surface is the log stream. A consistent
 * `[level] [scope] message {json}` shape makes those logs greppable and lets us
 * silence noise in production without touching call sites.
 *
 * LOG_LEVEL env: debug | info | warn | error | silent  (default: info)
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function emit(level, scope, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = `[${level.toUpperCase()}] [${scope}] ${message}`;
  const payload = meta === undefined ? '' : ` ${safeJson(meta)}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(line + payload);
}

function safeJson(meta) {
  try {
    if (meta instanceof Error) return JSON.stringify({ error: meta.message });
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

/**
 * Create a logger bound to a scope, e.g. `createLogger('LinkedIn')`.
 * @param {string} scope
 */
export function createLogger(scope) {
  return {
    debug: (message, meta) => emit('debug', scope, message, meta),
    info: (message, meta) => emit('info', scope, message, meta),
    warn: (message, meta) => emit('warn', scope, message, meta),
    error: (message, meta) => emit('error', scope, message, meta),
    /** Child logger: createLogger('Pipeline').child('dedupe') -> [Pipeline:dedupe] */
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

export const logger = createLogger('App');

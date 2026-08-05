/**
 * Source registry — the ONLY place that knows which boards exist.
 *
 * Adding a board is: write the adapter file, import it, add it to SOURCES.
 * Nothing else in the system changes. The pipeline iterates the registry, the
 * API exposes it, and the app renders a badge from `label`.
 */

import linkedin from './linkedin.js';
import greenhouse from './greenhouse.js';
import lever from './lever.js';
import ashby from './ashby.js';
import remoteok from './remoteok.js';
import weworkremotely from './weworkremotely.js';
import rozee from './rozee.js';
import { defineUnavailableSource } from './Source.js';

/**
 * Boards we deliberately declare but cannot fetch. They surface in
 * `GET /api/sources` with a reason so the app can show "coming soon" instead
 * of pretending the integration does not exist.
 *
 * Both were probed and returned HTTP 403 from a datacenter IP.
 */
const indeed = defineUnavailableSource(
  'indeed',
  'Indeed',
  'No public API for new publishers, and scraping is Cloudflare-blocked (verified HTTP 403) and prohibited by their ToS. Requires a commercial data partner.',
  'https://www.indeed.com'
);

const wellfound = defineUnavailableSource(
  'wellfound',
  'Wellfound',
  'Cloudflare-protected and login-gated (verified HTTP 403). No public jobs API.',
  'https://wellfound.com'
);

/** All known sources, in ingest priority order. */
export const SOURCES = [
  linkedin,
  greenhouse,
  lever,
  ashby,
  remoteok,
  weworkremotely,
  rozee,
  indeed,
  wellfound,
];

const BY_ID = new Map(SOURCES.map((source) => [source.id, source]));

/** @returns {import('./Source.js').JobSource|undefined} */
export function getSource(id) {
  return BY_ID.get(id);
}

/**
 * Sources that can actually run right now.
 *
 * A source is enabled when it is technically available AND not switched off by
 * env. `DISABLED_SOURCES=remoteok,ashby` is the kill switch for a board that
 * starts misbehaving in production — no deploy of code required.
 */
export function getEnabledSources() {
  const disabled = new Set(
    (process.env.DISABLED_SOURCES || '')
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean)
  );

  return SOURCES.filter((source) => source.available && !disabled.has(source.id));
}

/** Serialisable view for `GET /api/sources` and the app's badge legend. */
export function describeSources() {
  const disabled = new Set(
    (process.env.DISABLED_SOURCES || '').split(',').map((id) => id.trim().toLowerCase())
  );

  return SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    homepage: source.homepage,
    available: source.available,
    enabled: source.available && !disabled.has(source.id),
    unavailableReason: source.unavailableReason,
    attribution: source.attribution,
    capabilities: source.capabilities,
  }));
}

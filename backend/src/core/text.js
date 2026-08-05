/**
 * Text utilities shared by adapters.
 *
 * ATS APIs return job bodies in three different broken shapes: raw HTML,
 * HTML-entity-escaped HTML (Greenhouse double-encodes), and plain text. The
 * scorer only wants readable prose, so every adapter funnels through here.
 */

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
};

/** Decode HTML entities, twice — Greenhouse escapes its already-HTML content. */
export function decodeEntities(input, passes = 2) {
  let out = String(input ?? '');
  for (let i = 0; i < passes; i++) {
    out = out
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&[a-z]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
  }
  return out;
}

/**
 * Turn any of the three shapes into clean, single-spaced plain text.
 * @param {string} input
 * @param {number} [maxLength]
 */
export function toPlainText(input, maxLength = 6000) {
  if (!input) return '';
  return decodeEntities(input)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Convert an ISO-2 country code from a source into our canonical country id. */
export function fromIso2(code) {
  if (!code || typeof code !== 'string') return null;
  const upper = code.trim().toUpperCase();
  return upper.length === 2 ? upper : null;
}

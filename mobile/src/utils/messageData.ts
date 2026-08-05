import { RemoteMessageData } from '../types';

/**
 * FCM delivers `data` as a flat map of strings. Parsing it in one place means a
 * renamed backend field breaks here, loudly, instead of silently producing
 * `undefined` at three different call sites.
 */
export function parseRemoteMessageData(
  data: Record<string, unknown> | undefined
): RemoteMessageData {
  if (!data) return {};
  const read = (key: string) => (data[key] != null ? String(data[key]) : undefined);

  return {
    type: read('type'),
    jobKey: read('jobKey'),
    score: read('score'),
    title: read('title'),
    company: read('company'),
    location: read('location'),
    source: read('source'),
    applyUrl: read('applyUrl'),
    count: read('count'),
  };
}

/** The ORIGINAL posting URL carried by a job notification. */
export function getMessageLink(data: Record<string, unknown> | undefined): string | undefined {
  const parsed = parseRemoteMessageData(data);
  return parsed.applyUrl && /^https?:\/\//i.test(parsed.applyUrl) ? parsed.applyUrl : undefined;
}

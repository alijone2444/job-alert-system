import { RemoteMessageData } from '../types/job';

export function parseRemoteMessageData(
  data: Record<string, unknown> | undefined
): RemoteMessageData {
  if (!data) return {};

  return {
    jobId: typeof data.jobId === 'string' ? data.jobId : undefined,
    platform: typeof data.platform === 'string' ? data.platform : undefined,
    title: typeof data.title === 'string' ? data.title : undefined,
    link: typeof data.link === 'string' ? data.link : undefined,
    company: typeof data.company === 'string' ? data.company : undefined,
    location: typeof data.location === 'string' ? data.location : undefined,
  };
}

export function getMessageLink(data: Record<string, unknown> | undefined): string | undefined {
  return parseRemoteMessageData(data).link;
}

export type JobAlert = {
  id: string;
  jobId: string;
  platform: 'Upwork' | 'LinkedIn' | string;
  title: string;
  link: string;
  description?: string;
  company?: string;
  location?: string;
  country?: string;
  publishedAt?: string;
  notifiedAt?: string;
  createdAt?: { seconds: number; nanoseconds: number } | string;
};

export type RemoteMessageData = {
  jobId?: string;
  platform?: string;
  title?: string;
  link?: string;
  company?: string;
  location?: string;
};

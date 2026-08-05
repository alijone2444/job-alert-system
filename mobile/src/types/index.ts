/**
 * Shared domain types. These mirror the backend's NormalizedJob / feed entry /
 * preferences documents — see backend/src/core/.
 */

export type Salary = {
  min: number | null;
  max: number | null;
  currency: string;
  period: 'hour' | 'month' | 'year';
};

export type ScoreDimension = {
  state: 'scored' | 'unknown' | 'not_applicable';
  weight: number;
  credit: number | null;
  detail: string;
};

/**
 * One card in the personalised feed.
 * Denormalised by the backend so the list renders without any join.
 */
export type FeedItem = {
  id: string;
  jobKey: string;
  score: number;
  matchedSkills: string[];
  reasons: string[];
  breakdown?: Record<string, ScoreDimension>;

  title: string;
  company?: string;
  location?: string;
  country?: string | null;
  workplace?: string | null;
  jobType?: string | null;
  experienceLevel?: string | null;
  skills: string[];
  salary?: Salary | null;

  /** The ORIGINAL posting. Tapping Apply opens exactly this. */
  applyUrl: string;
  postedAt: string;

  source: string;
  sources?: string[];

  notified?: boolean;
  createdAt?: { seconds: number; nanoseconds: number } | string;

  // Client-side interaction state, merged in from the interactions collection.
  isSaved?: boolean;
  isApplied?: boolean;
  isHidden?: boolean;
};

export type Preferences = {
  countries: string[];
  skills: string[];
  jobTypes: string[];
  workplaces: string[];
  levels: string[];
  salary: { min: number | null; max: number | null; currency: string };
  preferredCompanies: string[];
  blockedCompanies: string[];
  keywordsInclude: string[];
  keywordsExclude: string[];
  strictCountry: boolean;
  feedThreshold: number;
  notifyThreshold: number;
  notificationsEnabled: boolean;
  version: number;
  updatedAt: string;
};

export type SavedJob = {
  id: string;
  jobKey: string;
  state: 'saved' | 'hidden' | 'none';
  appliedAt?: string;
  updatedAt?: string;
  snapshot?: {
    title: string;
    company?: string;
    location?: string;
    country?: string | null;
    workplace?: string | null;
    jobType?: string | null;
    salary?: Salary | null;
    source: string;
    applyUrl: string;
    postedAt: string;
    skills?: string[];
  };
};

export type SourceInfo = {
  id: string;
  label: string;
  homepage: string;
  available: boolean;
  enabled: boolean;
  unavailableReason: string | null;
  attribution: string | null;
  capabilities: Record<string, boolean>;
  health?: {
    lastStatus?: string;
    lastJobs?: number;
    lastError?: string | null;
    lastRunAt?: string;
  } | null;
};

export type RemoteMessageData = {
  type?: string;
  jobKey?: string;
  score?: string;
  title?: string;
  company?: string;
  location?: string;
  source?: string;
  applyUrl?: string;
  count?: string;
};

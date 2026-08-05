/**
 * Typed REST client for the backend.
 *
 * DESIGN: writes go through this client; the live feed READ comes from a
 * Firestore listener instead (see services/feed.ts). That split is deliberate —
 * Firestore gives real-time updates and offline caching for free, which is
 * exactly what a feed needs, while an HTTP endpoint gives the server a place to
 * run logic (validation, rescoring, dedupe of interaction state) that must not
 * live on a client we cannot trust.
 *
 * Every call fails soft: the caller gets a typed error and the UI degrades,
 * because a mobile app that throws on a flaky connection is broken by design.
 */

import { API_BASE_URL, APP_API_KEY, API_TIMEOUT_MS } from '../config/env';
import { logger } from '../utils/logger';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  timeoutMs?: number;
};

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, timeoutMs = API_TIMEOUT_MS } = options;
  const url = buildUrl(path, query);

  // React Native's fetch has no timeout — a stalled request would hang the UI
  // forever, so every call gets an explicit abort.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (APP_API_KEY) headers['X-App-Key'] = APP_API_KEY;

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await response.text();
    const payload = text ? safeJson(text) : {};

    if (!response.ok || payload?.ok === false) {
      const message = payload?.error || `HTTP ${response.status}`;
      throw new ApiError(response.status, message);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message =
      (error as Error)?.name === 'AbortError'
        ? 'Request timed out'
        : (error as Error)?.message || 'Network error';
    logger.warn('Api', `${method} ${path} failed: ${message}`);
    throw new ApiError(0, message);
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export const api = {
  register: (payload: { userId: string; fcmToken?: string; platform?: string; appVersion?: string }) =>
    request<{ userId: string; isNew: boolean; preferences: any }>('/api/register', {
      method: 'POST',
      body: payload,
    }),

  getPreferences: (userId: string) =>
    request<{ preferences: any }>('/api/preferences', { query: { userId } }),

  savePreferences: (userId: string, preferences: unknown) =>
    request<{ preferences: any; rebuilt: boolean; matched?: number; scanned?: number }>(
      '/api/preferences',
      { method: 'POST', body: { userId, preferences } }
    ),

  getFeed: (params: {
    userId: string;
    limit?: number;
    cursor?: string;
    minScore?: number;
    source?: string;
    workplace?: string;
    search?: string;
  }) => request<{ items: any[]; nextCursor: string | null; meta: any }>('/api/feed', { query: params }),

  interact: (payload: {
    userId: string;
    jobKey: string;
    action: 'save' | 'unsave' | 'hide' | 'unhide' | 'apply';
    snapshot?: unknown;
  }) => request<{ jobKey: string; action: string }>('/api/interactions', { method: 'POST', body: payload }),

  rescore: (userId: string) =>
    request<{ matched: number; scanned: number }>('/api/rescore', {
      method: 'POST',
      body: { userId },
      timeoutMs: 30000, // a rebuild scans the whole recent window
    }),

  getTaxonomy: () => request<{ taxonomy: any }>('/api/taxonomy'),

  getSources: () => request<{ sources: any[] }>('/api/sources'),

  getHealth: () => request<any>('/api/health'),
};

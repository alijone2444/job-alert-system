/**
 * Preferences service.
 *
 * READS come from a Firestore listener (instant, offline-capable, and stays in
 * sync if the same account is edited elsewhere). WRITES go through the REST
 * API, because saving preferences must also trigger a server-side feed
 * rebuild — and that has to happen somewhere the client cannot skip.
 */

import firestore from '@react-native-firebase/firestore';
import { api } from '../api/client';
import { Preferences } from '../types';
import { BUNDLED_TAXONOMY, Taxonomy } from '../domain/taxonomy';
import { logger } from '../utils/logger';

export const DEFAULT_PREFERENCES: Preferences = {
  countries: [],
  skills: [],
  jobTypes: [],
  workplaces: [],
  levels: [],
  salary: { min: null, max: null, currency: 'USD' },
  preferredCompanies: [],
  blockedCompanies: [],
  keywordsInclude: [],
  keywordsExclude: [],
  strictCountry: false,
  feedThreshold: 70,
  // Hard floor, enforced server-side too — see backend MIN_NOTIFY_THRESHOLD.
  notifyThreshold: 85,
  notificationsEnabled: true,
  version: 0,
  updatedAt: '',
};

function preferencesRef(userId: string) {
  return firestore().collection('users').doc(userId).collection('settings').doc('preferences');
}

export function subscribeToPreferences(
  userId: string,
  onData: (preferences: Preferences) => void
): () => void {
  return preferencesRef(userId).onSnapshot(
    (snapshot) => {
      // `exists` is a method in RNFirebase v22+, not a property.
      const data = snapshot.exists() ? snapshot.data() : {};
      onData({ ...DEFAULT_PREFERENCES, ...(data as Partial<Preferences>) });
    },
    (error) => logger.error('Preferences', 'Listener error', error.message)
  );
}

/**
 * Persist preferences and rebuild the feed.
 * @returns how many jobs matched after the rebuild, when the server reports it
 */
export async function savePreferences(
  userId: string,
  preferences: Preferences
): Promise<{ matched?: number; scanned?: number; rebuilt: boolean }> {
  logger.info('Preferences', 'Saving preferences...');
  const result = await api.savePreferences(userId, preferences);
  logger.success('Preferences', `Saved (rebuilt: ${result.rebuilt}, matched: ${result.matched ?? 0})`);
  return { matched: result.matched, scanned: result.scanned, rebuilt: result.rebuilt };
}

/**
 * Option lists for the Personalize screen.
 *
 * Returns the bundled copy immediately if the network is unavailable, so the
 * settings screen is never blank. The server copy wins when reachable, which
 * is how a newly-added skill shows up without an app update.
 */
export async function loadTaxonomy(): Promise<Taxonomy> {
  try {
    const { taxonomy } = await api.getTaxonomy();
    if (taxonomy?.skills?.length && taxonomy?.countries?.length) {
      logger.info('Preferences', 'Loaded taxonomy from backend');
      return {
        countries: taxonomy.countries,
        skills: taxonomy.skills,
        skillGroups: taxonomy.skillGroups ?? BUNDLED_TAXONOMY.skillGroups,
        jobTypes: taxonomy.jobTypes,
        workplaces: taxonomy.workplaces,
        levels: taxonomy.levels,
        currencies: taxonomy.currencies ?? BUNDLED_TAXONOMY.currencies,
      };
    }
  } catch {
    logger.warn('Preferences', 'Backend taxonomy unreachable — using bundled copy');
  }
  return BUNDLED_TAXONOMY;
}

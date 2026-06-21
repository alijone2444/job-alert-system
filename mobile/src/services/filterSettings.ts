import firestore from '@react-native-firebase/firestore';
import { logger } from '../utils/logger';

// Country -> LinkedIn geoId. Must stay in sync with the backend's GEO_COUNTRY map.
export const COUNTRY_GEO: Record<string, string> = {
  Pakistan: '101022442',
  'United States': '103644278',
  'United Kingdom': '101165590',
  Canada: '101174742',
  Germany: '101282230',
};

export const ALL_COUNTRY = 'All';
export const DEFAULT_COUNTRY = 'Pakistan';

// Time-posted options (LinkedIn f_TPR values).
export const TIME_OPTIONS: { label: string; value: string }[] = [
  { label: 'Last hour', value: 'r3600' },
  { label: 'Last 2 hours', value: 'r7200' },
  { label: 'Last 24 hours', value: 'r86400' },
  { label: 'Last week', value: 'r604800' },
];
export const DEFAULT_TIME = 'r86400';

// Sort options (LinkedIn sortBy values).
export const SORT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Most recent', value: 'DD' },
  { label: 'Most relevant', value: 'R' },
];
export const DEFAULT_SORT = 'DD';

export type FilterSettings = {
  country: string;
  timePosted: string;
  sortBy: string;
};

const SETTINGS_DOC = 'settings/filters';

/** Read the current filters the backend is using (with sensible defaults). */
export async function getFilters(): Promise<FilterSettings> {
  try {
    const snap = await firestore().doc(SETTINGS_DOC).get();
    const d = snap.data() || {};
    return {
      country: (d.country as string) || DEFAULT_COUNTRY,
      timePosted: (d.timePosted as string) || DEFAULT_TIME,
      sortBy: (d.sortBy as string) || DEFAULT_SORT,
    };
  } catch (error) {
    logger.warn('Filters', 'Could not read filter settings', error);
    return { country: DEFAULT_COUNTRY, timePosted: DEFAULT_TIME, sortBy: DEFAULT_SORT };
  }
}

async function writeSettings(patch: Record<string, unknown>): Promise<void> {
  try {
    await firestore()
      .doc(SETTINGS_DOC)
      .set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
    logger.info('Filters', `Updated: ${JSON.stringify(patch)}`);
  } catch (error) {
    logger.error('Filters', 'Failed to save filter settings', error);
  }
}

/** Country selection — also drives which country the backend fetches. */
export async function setSelectedCountry(country: string): Promise<void> {
  const geoIds =
    country === ALL_COUNTRY
      ? Object.values(COUNTRY_GEO)
      : COUNTRY_GEO[country]
        ? [COUNTRY_GEO[country]]
        : [];
  await writeSettings({ country, geoIds });
}

export async function setTimePosted(value: string): Promise<void> {
  await writeSettings({ timePosted: value });
}

export async function setSortBy(value: string): Promise<void> {
  await writeSettings({ sortBy: value });
}

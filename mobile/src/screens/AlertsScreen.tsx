import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Alert,
  AppState,
} from 'react-native';
import { useAlerts } from '../hooks/useAlerts';
import { AlertItem } from '../components/AlertItem';
import { Dropdown } from '../components/Dropdown';
import { ScreenHeader } from '../components/ScreenHeader';
import { JobAlert } from '../types/job';
import { logger } from '../utils/logger';
import {
  ALL_COUNTRY,
  COUNTRY_GEO,
  DEFAULT_COUNTRY,
  DEFAULT_TIME,
  DEFAULT_SORT,
  TIME_OPTIONS,
  SORT_OPTIONS,
  getFilters,
  setSelectedCountry,
  setTimePosted,
  setSortBy,
} from '../services/filterSettings';
import { loadViewed, saveViewed } from '../services/viewedJobs';

// How many (most recent) jobs to show.
const SHOW_OPTIONS = [
  { label: 'Last 10', value: '10' },
  { label: 'Last 20', value: '20' },
  { label: 'Last 50', value: '50' },
  { label: 'All', value: '100000' },
];
const DEFAULT_SHOW = '20';

type Props = {
  /** When set, only jobs from this platform are shown. */
  platform?: 'LinkedIn' | 'Upwork' | 'Remote';
  title?: string;
};

// Fixed country filter options. Picking one tells the backend which country to
// fetch (and filters the list). "All" fetches every country.
const COUNTRIES = [ALL_COUNTRY, ...Object.keys(COUNTRY_GEO)];

/** Does this job belong to the selected country? */
function inCountry(job: JobAlert, country: string): boolean {
  if (country === ALL_COUNTRY) return true;
  if ((job.country || '').toLowerCase() === country.toLowerCase()) return true;
  // Fallback for older jobs saved before the country tag existed.
  return (job.location || '').toLowerCase().includes(country.toLowerCase());
}

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ label: c, value: c }));

export function AlertsScreen({ platform, title }: Props) {
  const { alerts, loading, error, refreshing, refresh } = useAlerts();
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState(DEFAULT_COUNTRY);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [show, setShow] = useState(DEFAULT_SHOW);
  const [viewed, setViewed] = useState<Set<string>>(new Set());

  // Load the filters the backend is currently using (persisted in Firestore).
  useEffect(() => {
    getFilters().then((f) => {
      setLocation(f.country);
      setTime(f.timePosted);
      setSort(f.sortBy);
    });
    loadViewed().then(setViewed);

    // Re-sync viewed jobs when returning to the app (e.g. after opening a job
    // from its notification, which marks it viewed).
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') loadViewed().then(setViewed);
    });
    return () => sub.remove();
  }, []);

  // Mark a job as viewed (persisted locally) so its card greys out.
  const markViewed = useCallback((id: string) => {
    setViewed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveViewed(next);
      return next;
    });
  }, []);

  // Country choice also drives which country the backend fetches + filters list.
  const onSelectCountry = useCallback((country: string) => {
    setLocation(country);
    setSelectedCountry(country);
  }, []);

  // Time + sort are server-side fetch settings (applied on the next poll cycle).
  const onSelectTime = useCallback((value: string) => {
    setTime(value);
    setTimePosted(value);
  }, []);

  const onSelectSort = useCallback((value: string) => {
    setSort(value);
    setSortBy(value);
  }, []);

  const openJobLink = useCallback(async (job: JobAlert) => {
    if (!job.link) {
      Alert.alert('No link', 'This job alert does not have a valid URL.');
      return;
    }
    markViewed(job.id);
    try {
      logger.info('Alerts', `Opening job: ${job.title}`);
      // NOTE: do NOT use Linking.canOpenURL here — on Android 11+ it returns
      // false for https unless the scheme is declared, which blocked opening.
      await Linking.openURL(job.link);
    } catch {
      Alert.alert('Could not open link', job.link);
    }
  }, [markViewed]);

  // Jobs for this tab's platform (or all platforms).
  const platformJobs = useMemo(
    () => (platform ? alerts.filter((j) => j.platform === platform) : alerts),
    [alerts, platform]
  );

  // Apply country + search filters, then cap to the chosen "show" count.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = platformJobs.filter((job) => {
      // Remote jobs aren't country-specific, so don't apply the country filter.
      if (platform !== 'Remote' && !inCountry(job, location)) return false;
      if (q) {
        const hay = `${job.title} ${job.company ?? ''} ${job.location ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return matched.slice(0, parseInt(show, 10) || 20);
  }, [platformJobs, query, location, show]);

  const headerTitle = title ?? (platform ? `${platform} Jobs` : 'Job Alerts');

  if (loading && alerts.length === 0) {
    return (
      <View style={styles.container}>
        <ScreenHeader title={headerTitle} subtitle="Loading..." />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1A73E8" />
          <Text style={styles.loadingText}>Loading job alerts…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={headerTitle}
        subtitle={`${filtered.length} of ${platformJobs.length} job${platformJobs.length !== 1 ? 's' : ''}`}
      />

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search title, company, location…"
          placeholderTextColor="#9AA0A6"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
            <Text style={styles.clearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filters — country drives both the list and what the backend fetches;
          posted-within + sort are server-side; show is a local count cap. */}
      <View style={styles.filters}>
        <View style={styles.filterRow}>
          <Dropdown label="Country" value={location} options={COUNTRY_OPTIONS} onSelect={onSelectCountry} />
          <Dropdown label="Posted" value={time} options={TIME_OPTIONS} onSelect={onSelectTime} />
        </View>
        <View style={styles.filterRow}>
          <Dropdown label="Sort" value={sort} options={SORT_OPTIONS} onSelect={onSelectSort} />
          <Dropdown label="Show" value={show} options={SHOW_OPTIONS} onSelect={setShow} />
        </View>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <AlertItem job={item} onPress={openJobLink} viewed={viewed.has(item.id)} />
        )}
        contentContainerStyle={filtered.length === 0 ? styles.emptyList : styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#1A73E8" />
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>
              {query || location !== ALL_COUNTRY ? 'No matching jobs' : 'No alerts yet'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {query || location !== ALL_COUNTRY
                ? `No ${location} jobs yet — try another country or search.`
                : `New ${platform ?? 'LinkedIn'} jobs matching your keywords will appear here.`}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  searchWrap: {
    marginHorizontal: 16,
    marginTop: 12,
    justifyContent: 'center',
  },
  search: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8EAED',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#202124',
  },
  clearBtn: {
    position: 'absolute',
    right: 12,
    padding: 4,
  },
  clearText: { color: '#9AA0A6', fontSize: 14 },
  filters: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 10,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  list: { paddingTop: 4, paddingBottom: 32 },
  emptyList: { flexGrow: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 12, fontSize: 15, color: '#5F6368' },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#202124', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#5F6368', textAlign: 'center', lineHeight: 20 },
  errorBanner: {
    backgroundColor: '#FCE8E6',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
  },
  errorText: { color: '#C5221F', fontSize: 13 },
});

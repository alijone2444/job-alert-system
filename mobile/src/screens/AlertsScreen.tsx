import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Alert,
} from 'react-native';
import { useAlerts } from '../hooks/useAlerts';
import { AlertItem } from '../components/AlertItem';
import { ScreenHeader } from '../components/ScreenHeader';
import { JobAlert } from '../types/job';
import { logger } from '../utils/logger';

export function AlertsScreen() {
  const { alerts, loading, error, refreshing, refresh } = useAlerts();

  const openJobLink = useCallback(async (job: JobAlert) => {
    if (!job.link) {
      Alert.alert('No link', 'This job alert does not have a valid URL.');
      return;
    }

    try {
      logger.info('Alerts', `Opening job: ${job.title}`);
      const supported = await Linking.canOpenURL(job.link);
      if (supported) {
        await Linking.openURL(job.link);
      } else {
        Alert.alert('Cannot open link', job.link);
      }
    } catch {
      Alert.alert('Error', 'Failed to open the job link.');
    }
  }, []);

  if (loading && alerts.length === 0) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Job Alerts" subtitle="Loading..." />
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
        title="Job Alerts"
        subtitle={`${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`}
      />

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={alerts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AlertItem job={item} onPress={openJobLink} />}
        contentContainerStyle={alerts.length === 0 ? styles.emptyList : styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#1A73E8" />
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No alerts yet</Text>
            <Text style={styles.emptySubtitle}>
              New Upwork and LinkedIn jobs matching your keywords will appear here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  list: {
    paddingTop: 16,
    paddingBottom: 32,
  },
  emptyList: {
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#5F6368',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#5F6368',
    textAlign: 'center',
    lineHeight: 20,
  },
  errorBanner: {
    backgroundColor: '#FCE8E6',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
  },
  errorText: {
    color: '#C5221F',
    fontSize: 13,
  },
});

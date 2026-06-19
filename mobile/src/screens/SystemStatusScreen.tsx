import React, { useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useAppStatus } from '../hooks/useAppStatus';
import { useBackendStatus } from '../hooks/useBackendStatus';
import { useAppContext } from '../context/AppContext';
import { StatusBanner } from '../components/StatusBanner';
import { BackendStatusBanner } from '../components/BackendStatusBanner';
import { ScreenHeader } from '../components/ScreenHeader';

export function SystemStatusScreen() {
  const { deviceId } = useAppContext();
  const { status, checking, refresh: refreshAppStatus } = useAppStatus(deviceId);
  const { status: backendStatus, loading: backendLoading, refresh: refreshBackend } =
    useBackendStatus();

  const handleRefresh = useCallback(() => {
    refreshAppStatus();
    refreshBackend();
  }, [refreshAppStatus, refreshBackend]);

  const refreshing = checking || backendLoading;

  return (
    <View style={styles.container}>
      <ScreenHeader title="System Status" subtitle="Firebase, Push & Backend health" />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#1A73E8" />
        }
      >
        <StatusBanner status={status} checking={checking} onRefresh={refreshAppStatus} />
        <BackendStatusBanner
          status={backendStatus}
          loading={backendLoading}
          onRefresh={refreshBackend}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  content: {
    paddingTop: 16,
    paddingBottom: 32,
  },
});

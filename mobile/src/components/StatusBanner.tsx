import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { AppHealthStatus } from '../services/firebaseHealth';

type Props = {
  status: AppHealthStatus;
  checking: boolean;
  onRefresh: () => void;
};

function StatusDot({ ok }: { ok: boolean }) {
  return <View style={[styles.dot, { backgroundColor: ok ? '#34A853' : '#EA4335' }]} />;
}

export function StatusBanner({ status, checking, onRefresh }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.title}>System Status</Text>
        <TouchableOpacity onPress={onRefresh} disabled={checking}>
          {checking ? (
            <ActivityIndicator size="small" color="#1A73E8" />
          ) : (
            <Text style={styles.refresh}>Refresh</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        <View style={styles.item}>
          <StatusDot ok={status.firebaseApp} />
          <Text style={styles.label}>Firebase App</Text>
          <Text style={styles.value}>{status.firebaseApp ? 'Connected' : 'Failed'}</Text>
        </View>

        <View style={styles.item}>
          <StatusDot ok={status.firestore === 'connected'} />
          <Text style={styles.label}>Firestore</Text>
          <Text style={styles.value}>
            {status.firestore === 'checking'
              ? 'Checking...'
              : status.firestore === 'connected'
                ? 'Connected'
                : 'Error'}
          </Text>
        </View>

        <View style={styles.item}>
          <StatusDot ok={status.fcmPermission === 'granted'} />
          <Text style={styles.label}>Push Permission</Text>
          <Text style={styles.value}>
            {status.fcmPermission === 'granted' ? 'Granted' : status.fcmPermission}
          </Text>
        </View>

        <View style={styles.item}>
          <StatusDot ok={!!status.fcmToken} />
          <Text style={styles.label}>FCM Token</Text>
          <Text style={styles.value} numberOfLines={1}>
            {status.fcmToken ? `${status.fcmToken.slice(0, 16)}…` : 'Missing'}
          </Text>
        </View>
      </View>

      {status.projectId && (
        <Text style={styles.meta}>Project: {status.projectId}</Text>
      )}
      {status.deviceId && (
        <Text style={styles.meta}>Device: {status.deviceId}</Text>
      )}
      {status.firestoreError && (
        <Text style={styles.errorText}>{status.firestoreError}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#202124',
  },
  refresh: {
    fontSize: 13,
    color: '#1A73E8',
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  item: {
    width: '48%',
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 6,
  },
  label: {
    fontSize: 11,
    color: '#5F6368',
    marginBottom: 2,
  },
  value: {
    fontSize: 12,
    fontWeight: '600',
    color: '#202124',
  },
  meta: {
    marginTop: 8,
    fontSize: 11,
    color: '#5F6368',
  },
  errorText: {
    marginTop: 8,
    fontSize: 11,
    color: '#C5221F',
  },
});

import firebase from '@react-native-firebase/app';
import firestore from '@react-native-firebase/firestore';
import messaging from '@react-native-firebase/messaging';
import { logger } from '../utils/logger';

export type AppHealthStatus = {
  firebaseApp: boolean;
  projectId: string | null;
  firestore: 'connected' | 'error' | 'checking';
  firestoreError: string | null;
  fcmPermission: 'granted' | 'denied' | 'unknown';
  fcmToken: string | null;
  deviceId: string | null;
};

export async function checkFirebaseApp(): Promise<{ ok: boolean; projectId: string | null }> {
  try {
    const app = firebase.app();
    const projectId = app.options.projectId ?? null;
    logger.success('Firebase', `App initialized — project: ${projectId ?? 'unknown'}`);
    return { ok: true, projectId };
  } catch (error) {
    logger.error('Firebase', 'App NOT initialized', error);
    return { ok: false, projectId: null };
  }
}

export async function checkFirestoreConnection(): Promise<{ ok: boolean; error: string | null }> {
  try {
    logger.info('Firestore', 'Testing connection — reading jobs collection...');
    const snapshot = await firestore().collection('jobs').limit(1).get();
    logger.success('Firestore', `Connected — sample read OK (${snapshot.size} doc(s) in test query)`);
    return { ok: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Firestore connection failed';
    logger.error('Firestore', 'Connection FAILED', message);
    return { ok: false, error: message };
  }
}

export async function checkFcmStatus(): Promise<{
  permission: 'granted' | 'denied' | 'unknown';
  token: string | null;
}> {
  try {
    const authStatus = await messaging().hasPermission();
    const granted =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    logger.info('FCM', `Permission status: ${granted ? 'GRANTED' : 'DENIED'} (code: ${authStatus})`);

    if (!granted) {
      return { permission: 'denied', token: null };
    }

    const token = await messaging().getToken();
    logger.success('FCM', `Token retrieved — ${token.slice(0, 20)}...`);
    return { permission: 'granted', token };
  } catch (error) {
    logger.error('FCM', 'Status check failed', error);
    return { permission: 'unknown', token: null };
  }
}

export async function runFullHealthCheck(deviceId?: string): Promise<AppHealthStatus> {
  logger.divider('HealthCheck');
  logger.info('HealthCheck', 'Starting full system check...');

  const appCheck = await checkFirebaseApp();
  const firestoreCheck = await checkFirestoreConnection();
  const fcmCheck = await checkFcmStatus();

  const status: AppHealthStatus = {
    firebaseApp: appCheck.ok,
    projectId: appCheck.projectId,
    firestore: firestoreCheck.ok ? 'connected' : 'error',
    firestoreError: firestoreCheck.error,
    fcmPermission: fcmCheck.permission,
    fcmToken: fcmCheck.token,
    deviceId: deviceId ?? null,
  };

  logger.info('HealthCheck', 'Summary:', status);
  logger.divider('HealthCheck');

  return status;
}

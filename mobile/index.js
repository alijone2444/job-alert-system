/**
 * @format
 */

import messaging from '@react-native-firebase/messaging';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

console.log('📱 JobAlert [Bootstrap] Registering background message handler...');

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('📱 JobAlert [FCM Background] ✅ Notification received:', {
    title: remoteMessage.notification?.title,
    body: remoteMessage.notification?.body,
    data: remoteMessage.data,
  });
});

console.log('📱 JobAlert [Bootstrap] Registering root component...');
AppRegistry.registerComponent(appName, () => App);

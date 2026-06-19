# Mobile — Job Alert App (React Native CLI)

React Native **CLI** app that receives FCM push notifications and displays job alerts from Firestore.

## Prerequisites

- Node.js 22+
- **Android:** Android Studio, JDK 17+, Android SDK
- **iOS (macOS only):** Xcode, CocoaPods
- Firebase project with FCM enabled

## Project Structure

```
mobile/
├── App.tsx                    # Root component + notification handlers
├── index.js                   # Entry + background FCM handler
├── android/                   # Native Android project
├── ios/                       # Native iOS project
├── google-services.json.example
├── GoogleService-Info.plist.example
└── src/
    ├── components/AlertItem.tsx
    ├── hooks/useAlerts.ts
    ├── screens/AlertsScreen.tsx
    ├── services/
    │   ├── device.ts          # Device ID + Firestore token sync
    │   └── notifications.ts   # FCM permissions + handlers
    └── types/job.ts
```

## Setup

### 1. Firebase config files

1. In [Firebase Console](https://console.firebase.google.com/), add an **Android** app with package name `com.jobalert`.
2. Download `google-services.json` → place at:
   ```
   mobile/android/app/google-services.json
   ```
3. Add an **iOS** app with bundle ID `com.jobalert`.
4. Download `GoogleService-Info.plist` → add to Xcode project under `ios/JobAlert/` (drag into Xcode).

### 2. Install dependencies

```bash
cd mobile
npm install
```

### 3. iOS only (macOS)

```bash
cd ios
bundle install        # first time only
bundle exec pod install
cd ..
```

### 4. iOS push notifications capability

In Xcode → **JobAlert** target → **Signing & Capabilities**:
- Add **Push Notifications**
- Add **Background Modes** → enable **Remote notifications**

Upload your APNs key/certificate in Firebase Console → Project Settings → Cloud Messaging.

### 5. Run the app

```bash
# Start Metro bundler
npm start

# Android (separate terminal)
npm run android

# iOS (macOS only)
npm run ios
```

## How notifications work

| State | Handler |
|-------|---------|
| Foreground | `messaging().onMessage` → in-app Alert |
| Background | `setBackgroundMessageHandler` in `index.js` |
| Quit / tap | `getInitialNotification` + `onNotificationOpenedApp` → opens job URL |

On startup the app:
1. Requests notification permission (iOS + Android 13+).
2. Gets the FCM token via `@react-native-firebase/messaging`.
3. Saves token to Firestore `users/{deviceId}` using `react-native-device-info`.

## Firestore

| Collection | Access |
|------------|--------|
| `users` | App writes FCM token |
| `jobs` | App reads alert history (written by backend) |

Deploy rules from `../firebase/firestore.rules`.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `google-services.json` missing | Place file in `android/app/` |
| No iOS push | Enable Push Notifications capability + APNs in Firebase |
| Firestore permission denied | Deploy `firebase/firestore.rules` |
| Android 13+ no notifications | `POST_NOTIFICATIONS` permission is requested on startup |
| Metro timeout / device not responding | See **Wireless debugging** below |

## Wireless debugging (physical device over Wi‑Fi)

If you see:
```
[timeout] connection terminated with Device ... after not responding for 60 seconds
```

1. **Only one ADB connection** — same phone connected twice causes this. Run `adb devices` and disconnect the duplicate:
   ```bash
   adb disconnect <duplicate-device-id>
   ```
2. **Port forwarding** (run before every session):
   ```bash
   adb reverse tcp:8081 tcp:8081
   ```
3. **Start Metro on all interfaces**:
   ```bash
   npm start
   ```
   (`package.json` already uses `--host 0.0.0.0`)
4. If still failing, on the phone open the **React Native Dev Menu** (shake device) → **Change Bundle Location** / **Debug server host** → set your PC IP, e.g. `192.168.18.131:8081`
5. Ensure phone and PC are on the **same Wi‑Fi** and Windows Firewall allows Node.js on port 8081.

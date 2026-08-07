# Release builds

`app-release.apk` here is the signed release build, ready to install.

    adb install -r builds/app-release.apk

or copy it to the phone and open it.

## Rebuilding

    cd mobile/android && ./gradlew assembleRelease

The output lands in `mobile/android/app/build/outputs/apk/release/app-release.apk`;
copy it here.

## Note

The release APK has the JS **bundled**. Force-stopping and relaunching does not
pick up a JS change — that only works with Metro in debug. Any change to the app
needs a rebuild and a reinstall.

Signing key: `mobile/android/app/jobalert-release.keystore` (gitignored — back it
up separately, it is required for every future update).

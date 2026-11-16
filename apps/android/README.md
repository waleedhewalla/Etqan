# Itqan Android app

The Itqan website in a native Android shell ([Capacitor](https://capacitorjs.com)). Every screen, the Arabic right-to-left
layout, offline review and live lessons are the website's own, so the app and the site never drift apart. The shell adds the
app icon, the microphone and camera permissions, the back button and a "no connection" page.

The app loads the website from its public address, so that address is the one build setting:

| Setting | Meaning |
| --- | --- |
| `ITQAN_APP_URL` | The website's address, e.g. `https://itqan.example.org`. Must be `https://`. |
| `ITQAN_ALLOW_HTTP=1` | Allows a plain `http://` address, only for a phone on your local network while developing. |

## Build a test APK on Windows

You need [Android Studio](https://developer.android.com/studio) (it brings the Android SDK and Java) and the repository's
usual `pnpm install`.

```powershell
cd C:\path\to\etqan
pnpm install
$env:ITQAN_APP_URL = "https://itqan.example.org"      # your website
pnpm --filter "@itqan/android" sync                   # creates and updates the Android project
pnpm --filter "@itqan/android" open                   # opens it in Android Studio: press Run, or Build > Build APK
```

Without Android Studio, the **Android app** workflow in GitHub (Actions tab, Run workflow) builds the APK and attaches it
to the run; download `itqan-debug-apk`, copy `app-debug.apk` to the phone and open it (allow installs from this source).

## What is where

- `capacitor.config.js`: app id (`org.itqan.app`), name, and the website address from `ITQAN_APP_URL`.
- `www/offline.html`: shown when the website cannot be reached.
- `android/`: the native project. Permissions are in `app/src/main/AndroidManifest.xml`; icons in `app/src/main/res/mipmap-*`.
  The generated web assets and the address are not committed.

## Before this goes to the Play Store

- A **release build** needs a signing key (`keytool`) and an app bundle (`./gradlew bundleRelease`). The debug APK is for testing only.
- The Play Store may question an app that only wraps a website. Native features (push notifications for reminders, the
  weekly report sharing) strengthen the case and are the next step.
- Raise `versionCode` and `versionName` in `android/app/build.gradle` for every upload.
- Live lessons need the media server reachable from phones (public `wss://` address, TURN), see `TESTING.md`.

# TASKLY Mobile (Android + iOS)

This is the native mobile companion for the existing TASKLY web app. It uses Expo / React Native and schedules **device-local notifications**. A scheduled local notification can be delivered by iOS or Android while the app is not running, subject to OS permissions, Focus/Do Not Disturb, battery settings and device policies.

## Run it

From the repository root:

```powershell
cd mobile
npm install
npx expo start
```

Install Expo Go on a phone and scan the QR code for a development preview. For a real installable build with native notification configuration, create an Expo development/production build using EAS Build.

## Current mobile starter features

- Add tasks with date, time, one-time, daily or weekly repeat.
- Schedule up to 45 upcoming device-local reminders per task.
- Default device notification sound and Android vibration channel.
- Mark complete to cancel pending reminders.
- Local persistence on the phone.

## Important limitations

- This mobile folder is a starter implementation, not a tested release build.
- Cloud login and phone/laptop synchronization are not connected yet. They require a configured Supabase project, authentication, database policies and conflict-safe sync.
- Server push notifications across devices require a backend scheduler and push token registration.
- iOS and Android control notification delivery and sound. Users must grant notification permission; silent mode, Focus/DND, low-power policies and device settings may suppress or alter alerts.
- This app uses the platform's default notification sound. A custom continuous alarm sound is not guaranteed when the app is closed.
- Recurring reminders are scheduled as a rolling set of future local notifications; reopen the app periodically so the rolling window can be refreshed.

## Build

Use an Expo EAS project and build separate iOS and Android binaries. iOS distribution requires an Apple Developer account. Android APK/AAB can be built with EAS; Google Play publishing has its own account and review requirements.

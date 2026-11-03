# TASKLY Mobile (Android + iOS)

## Run / preview
From the repository root:

```powershell
cd mobile
npm install
npx expo start
```

Scan the QR code with Expo Go for a development preview where supported. For installable native builds, use Expo EAS Build; iOS distribution requires Apple Developer setup.

## Included
- Create, edit, complete and delete tasks
- Due date and time, priority and reminder lead time
- One-time, daily, weekly and custom weekday repeats
- Per-task Silent, Low and High notification choices
- Local task storage using AsyncStorage
- Scheduled local notifications (up to 45 future repeat occurrences)

## Notification behavior
- Android: TASKLY creates separate silent, low and high notification channels. High uses a higher channel importance and vibration pattern. Android system settings can override channel behavior.
- iOS: notifications use the system's default sound and device volume/Focus settings. The app cannot force a louder sound or guarantee a continuous alarm.
- Notifications can be affected by permissions, Focus / Do Not Disturb, battery policies and OS settings.
- The app refreshes its rolling schedule when opened or brought back to the foreground.

## Local-only mode
Cloud sign-in and cloud syncing are intentionally not used. Tasks are stored on this device only. They will not automatically appear on the laptop or another phone.

## Testing status
This is a development version. It has not yet been built and tested on physical Android and iPhone devices. Do not treat notification delivery or sound levels as verified until tested on the target devices.

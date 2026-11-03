# TASKLY Mobile (Android + iOS)

## Run it
From the repository root:

```powershell
cd mobile
npm install
npx expo start
```

Install Expo Go on an Android phone to preview the app. For an installable release, create native builds with Expo EAS Build. iOS distribution requires Apple Developer setup.

## Cloud sync setup (required once)
1. Create a project in Supabase.
2. Open the SQL Editor and run `../supabase/migrations/001_taskly_schema.sql` (copy its contents into the editor).
3. In Supabase Authentication settings, enable email/password sign-in. Configure email confirmation as you prefer.
4. Copy `mobile/.env.example` to `mobile/.env`.
5. Set the project URL and public anon/publishable key in `.env`. Never use the service-role key in the app.
6. Stop and restart Expo after changing environment variables.

The app includes email sign-up/sign-in and basic task upsert/read synchronization. This initial sync merges tasks by ID and is not yet a full real-time/offline conflict-resolution system. Deleting a task removes it from the signed-in account. The laptop web app still needs its own Supabase login/sync integration before all devices share the same data.

## Notification sound choices
- Silent: no notification sound.
- Low: default system notification sound.
- High: default sound with high Android channel priority and vibration.

Android users can further adjust each notification channel in system settings. iOS uses the system's default notification sound and device volume/Focus settings; the app cannot force a louder sound. Scheduled local notifications may arrive while the app is closed, but delivery can be affected by OS permissions, Focus/Do Not Disturb, battery policies and device settings.

## Limits
This is a starter build and must be tested on physical Android and iOS devices. Recurring reminders are scheduled as a rolling window of up to 45 occurrences and refresh when the app is opened. Custom continuous alarm audio is not guaranteed when the app is closed.

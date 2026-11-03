# TASKLY — To-do & reminder app

A local-first task manager for laptop browsers and Android/iOS devices. Theme: Midnight Black, Electric Cobalt Blue and Acid Lime.

## Laptop / web app
1. Install Node.js LTS.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open the local URL printed by Vite.

The web app uses HTML, CSS and vanilla JavaScript. Tasks are stored in that browser's localStorage.

## Mobile app
See [mobile/README.md](mobile/README.md) for Expo setup and preview instructions.

## Features
- Add, edit, complete and delete tasks
- Due date, time, priority and reminder lead time
- One-time, daily, weekly and custom weekday repeat options
- Per-task Silent / Low / High reminder sound choice
- Today, Upcoming, All and Completed task views
- Local device/browser storage; no account or cloud setup required

## Important reminder limitations
- The mobile app schedules local notifications on the device. Android notification channels and iOS system settings control the final sound, volume, vibration and delivery. The app cannot force an iPhone alarm to be louder than the device permits.
- The web app checks deadlines and plays its in-page alarm while the page is open. A regular browser page cannot guarantee a custom audible alarm after the browser/app is fully closed.
- Browser notifications are controlled by browser and operating-system settings. Web push while closed is not configured.
- Recurring mobile notifications are scheduled in a rolling window (up to 45 future occurrences) and refreshed when the app is opened. This is not an indefinite alarm service.
- The project has not yet been tested on physical Android and iPhone devices. Treat it as a development build, not a finished store release.

## Cloud
Cloud sync is intentionally left disconnected for now. Local tasks stay on the device/browser where they were created; they do not automatically sync between devices. Supabase starter files remain in the repository for possible future use.

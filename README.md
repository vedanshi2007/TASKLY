# TASKLY — To-do & deadline alarm app

A responsive task manager with deadlines, recurring-task choices, progress tracking and reminder alarms. Theme: Midnight Black, Electric Cobalt Blue and Acid Lime.

## Run locally
1. Install Node.js LTS.
2. Clone or download this repository.
3. Run `npm install`, then `npm run dev`.
4. Open the local URL printed by Vite.

The app uses HTML, CSS and vanilla JavaScript (not React). Tasks are saved in the current browser using localStorage.

## Included
- Add, edit and delete tasks
- One-time, daily, weekly and custom repeat choices
- Due date/time, priority and reminder lead time
- Complete tasks, Today/Upcoming/All/Completed views
- Local alarm sound and browser notification permission
- PWA manifest and service worker starter
- Supabase SQL schema and example reminder Edge Functions

## Important implementation notes
- The current browser app is local-first. The Supabase login/cloud-sync frontend is not wired into this repository version yet; the SQL and Edge Function files are backend scaffolding only.
- Repeat choices are saved as task metadata; automatic generation of future recurring occurrences is not implemented yet.
- Local alarm checks run while the app page is open. A webpage cannot guarantee an audible alarm after the browser/device is fully closed.
- The Supabase reminder functions need a configured project, secrets, scheduler and end-to-end testing before use. The provided reminder code is a starter, not production-certified.
- Never commit Supabase service-role keys or VAPID private keys. Copy `supabase-config.js.example` only for a future client integration; it is not loaded by the current app.
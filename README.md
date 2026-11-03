# TASKLY — To-do & deadline alarm app

A responsive task manager with deadlines, recurring task options, progress tracking and reminder alarms. Theme: Midnight Black, Electric Cobalt Blue and Acid Lime.

## Run locally
1. Install Node.js LTS.
2. Clone or download this repository.
3. Run `npm install`, then `npm run dev`.
4. Open the local URL printed by Vite.

The app is built with HTML, CSS and vanilla JavaScript (not React). Tasks are stored in this browser's localStorage.

## Features
- Add, edit and delete tasks
- One-time, daily, weekly and custom repeat choices
- Due date/time, priority and reminder lead time
- Mark tasks complete
- Today, upcoming, all and completed views
- Local alarm sound and browser notifications
- PWA manifest and service worker starter

## Important limitations
This is a starter project, not a production-certified alarm service. Local alarms run while the app page is open. Browser/OS settings control notification delivery and sound when the page is closed. Cloud sync and server-side push require a separately configured Supabase project and tested backend functions. Do not commit service-role keys or VAPID private keys.
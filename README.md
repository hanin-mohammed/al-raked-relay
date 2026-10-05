# Al Raked Live Display

Small local proof of concept for showing the latest thirteen service entries on a TV, phone or tablet while tracking the latest thirty for status alerts.

## Run

```sh
cd /Users/hanin/Documents/ChatGPT/RDBMS/al-raked-live-display
npm start
```

Open `http://localhost:4173` on this Mac. Other devices on the same network can use the Mac's local IP address with port `4173`.

## Send a test entry

```sh
curl -X POST http://localhost:4173/api/entries \
  -H 'Content-Type: application/json' \
  -H 'X-Al-Raked-Feed-Key: local-proof-of-concept' \
  -d '{"timestamp":"2026-10-01T18:45:00+04:00","foreman":"Ahmed","employee":"Sampath","licensePlate":"A 12345","service":"Full wash","company":"Walk-in","price":"45"}'
```

The server keeps the latest thirty entries in memory. The display renders the newest thirteen while retaining all thirty for status alerts. Restarting it clears the list.

## Firebase mode

Localhost uses the proof-of-concept server by default. Add `?source=firebase` to the URL to test Firebase locally. A deployed copy uses Firebase automatically.

The Firebase database retains thirty fixed slots. Apps Script overwrites one slot per successful form submission, and the website sorts those records by timestamp. The display renders the newest thirteen while still watching all thirty for status changes.

The deployed display reconnects after Firebase errors, renews an idle stream after
five minutes, times out stalled authentication requests, reports a one-minute
health heartbeat, reloads after repeated recovery failures and performs a silent
preventive refresh every two hours between 07:00 and 22:20 Dubai time.
Normal Firebase reconnect and feed-recovery behaviour remains active whenever the
page is running, including after 22:20.

## Audio volume

The chime, three ready announcements and startup sound are loudness-matched. They
all use `MASTER_AUDIO_VOLUME` near the top of `public/app.js`. It is currently
`0.2`, or 20%. Change that one value from `0` to `1`, then run `npm run build`.

## Remote reload

Deploy `database.rules.json`, copy the updated
`Al_Raked_Firebase_Live_Display.gs` into the existing Apps Script project, then run
`requestRelayDisplayReload()` whenever the main TV page needs a remote refresh.
Commands expire after three minutes and each command runs only once per browser.
The existing one-minute `reconcileFirebaseLiveDisplayStatuses` trigger also checks
the global heartbeat after the first Relay page check-in each day. If the heartbeat
stays stale, it renews reload commands until the page reports healthy again. Set
the `FIREBASE_RELAY_HEALTH_MONITOR_ENABLED` Script Property to `false` to suspend
automatic reload commands without removing the trigger.

The same one-minute supervisor also checks `lastSnapshotAt`. A fresh heartbeat
with no Firebase snapshot for eight minutes is treated as a stalled feed and uses
the existing failure email, reload and recovery flow. Full sheet-to-Firebase
reconciliation is limited to once every five minutes; form submissions and
Finished edits still publish immediately. The separate five-minute
`refreshReportTimestamp` trigger is intentionally not installed because `calc()`
updates that timestamp whenever the report is rebuilt.

## Vercel

Import this project directory into Vercel with the framework preset set to **Other**.
The checked-in `vercel.json` runs `npm run build` and publishes the generated
`dist` directory. The four MP4 files are copied to `dist/media` during the build
and are served from `/media/...` by Vercel's static CDN. No environment variable
is required for the video files.

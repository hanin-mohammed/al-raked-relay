# Al Raked Live Display

Small local proof of concept for showing the latest ten service entries on a TV, phone or tablet.

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

The server keeps only the latest ten entries in memory. Restarting it clears the list.

## Firebase mode

Localhost uses the proof-of-concept server by default. Add `?source=firebase` to the URL to test Firebase locally. A deployed copy uses Firebase automatically.

The Firebase database retains ten fixed slots. Apps Script overwrites one slot per successful form submission, and the website sorts those records by timestamp.

## Vercel

Import this project directory into Vercel with the framework preset set to **Other**.
The checked-in `vercel.json` runs `npm run build` and publishes the generated
`dist` directory. The four MP4 files are copied to `dist/media` during the build
and are served from `/media/...` by Vercel's static CDN. No environment variable
is required for the video files.

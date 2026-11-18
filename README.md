# Camera + Telegram Consent 

A small educational project showing a transparent camera-to-Telegram workflow. The visitor must:
1. On page load, the browser is immediately asked for camera permission; the page visibly explains why.
2. If permission is granted, the live preview opens. No image is captured automatically.
3. Read the data-flow notice and check the consent box before taking a snapshot.
4. Take a snapshot and review it.
4. Check a separate box approving the exact photo to be sent.
5. Click the send button.

The app requests camera permission immediately on page load, but does not capture or send anything automatically. It sends only the JPEG snapshot the visitor separately approves and a fixed caption. It does not collect location, contacts, browsing history, or device identifiers.

## Requirements
- Node.js 18 or newer
- A Telegram bot you control and the destination chat ID
- Browser camera access (localhost works; remote hosting requires HTTPS)

## Setup (Windows)
1. Extract the ZIP.
2. Install Node.js 18+ if needed.
3. Copy `.env.example` and rename the copy to `.env`.
4. Put your bot token in `TELEGRAM_BOT_TOKEN` and destination chat/group ID in `TELEGRAM_CHAT_ID`.
5. Double-click `start.bat` (or run `npm install` then `npm start`).
6. Open `http://localhost:3000`.

## Telegram setup
1. Create a bot using Telegram's official @BotFather.
2. Start a chat with your bot and press Start, or add the bot to a group where you want the photo delivered.
3. Obtain the destination chat ID using a trusted method; for a private chat, you can inspect the bot's `getUpdates` response after sending it a message.
4. Keep the token private. Never paste it into the browser code, screenshots, GitHub, or this chat.

## Important security notes
- Do not deploy this publicly without adding authentication, HTTPS, stronger abuse controls, and a privacy notice suitable for your use.
- The bot token is read only by the Node.js server from `.env`.
- Do not commit `.env`; it is excluded by `.gitignore`.
- The server limits request size and rate.
- The browser's camera permission is separate from the page's consent checkbox.
- Stop the camera when finished. Closing the page also stops the camera tracks.
- Telegram delivery means the approved image leaves the visitor's device and is delivered to the configured Telegram chat. Make sure the visitor knows who controls that chat.

This is a demo, not a production-ready service.

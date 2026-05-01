// api/telegram-webhook.js - Webhook bot talent, balas /start dengan Chat ID
const BOT_TOKEN_TALENT = process.env.TELEGRAM_BOT_TOKEN_TALENT;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { message } = req.body;
    if (!message) return res.status(200).end();

    const chatId = message.chat.id;
    const text   = message.text || '';

    if (text === '/start') {
      const reply =
        `👋 Halo! Selamat datang di CallPay Notif Bot.\n\n` +
        `Chat ID kamu adalah:\n` +
        `<code>${chatId}</code>\n\n` +
        `Salin angka di atas, lalu paste di portal talent kamu di bagian ` +
        `<b>Settings → Telegram Chat ID</b> agar kamu bisa menerima notifikasi order masuk! 🔔`;

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN_TALENT}/sendMessage`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          chat_id   : chatId,
          text      : reply,
          parse_mode: 'HTML',
        }),
      });
    }

    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('Telegram webhook error:', e);
    return res.status(500).json({ error: e.message });
  }
};

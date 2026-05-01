// lib/telegram.js - Helper notifikasi Telegram

const BOT_TOKEN_TALENT = process.env.TELEGRAM_BOT_TOKEN_TALENT;
const BOT_TOKEN_AGENCY = process.env.TELEGRAM_BOT_TOKEN_AGENCY;
const GROUP_ID_ADMIN1  = process.env.TELEGRAM_GROUP_ID_ADMIN1;  // CallPay
const GROUP_ID_ADMIN2  = process.env.TELEGRAM_GROUP_ID_ADMIN2;  // SleepcallPay

async function sendTelegram(botToken, chatId, message) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        chat_id   : chatId,
        text      : message,
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json();
    if (!data.ok) console.error('Telegram error:', JSON.stringify(data));
    return data;
  } catch (e) {
    console.error('Telegram fetch error:', e.message);
  }
}

async function sendTelegramToAgency(adminParam, message) {
  const groupId = adminParam === 'admin2' ? GROUP_ID_ADMIN2 : GROUP_ID_ADMIN1;
  if (!groupId) { console.error('TELEGRAM_GROUP_ID tidak di-set'); return; }
  return sendTelegram(BOT_TOKEN_AGENCY, groupId, message);
}

async function sendTelegramToTalent(telegramChatId, message) {
  if (!telegramChatId) return;
  return sendTelegram(BOT_TOKEN_TALENT, telegramChatId, message);
}

module.exports = { sendTelegramToAgency, sendTelegramToTalent };

// api/midtrans-webhook.js - Terima notif dari Midtrans setelah pembayaran
const { fsGet, fsSet, fromFirestore } = require('../lib/firebase');
const { sendTelegramToAgency, sendTelegramToTalent } = require('../lib/telegram');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const notif = req.body;
    console.log('Midtrans webhook:', JSON.stringify(notif));

    const { order_id, transaction_status, fraud_status } = notif;
    if (!order_id) return res.status(400).json({ error: 'No order_id' });

    const isPaid = (
      transaction_status === 'capture' && fraud_status === 'accept'
    ) || transaction_status === 'settlement';

    if (!isPaid) {
      console.log('Payment not confirmed yet:', transaction_status);
      return res.status(200).json({ message: 'Not paid yet' });
    }

    const snap = await fsGet(`orders/${order_id}`);
    if (!snap || !snap.fields) return res.status(404).json({ error: 'Order not found' });
    const order = fromFirestore(snap.fields);

    if (order.status !== 'waiting_payment') {
      return res.status(200).json({ message: 'Already processed' });
    }

    const expiredAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    await fsSet(`orders/${order_id}`, { ...order, status: 'pending', expiredAt, paidAt: new Date().toISOString() });

    const price      = order.originalPrice || order.price || 0;
    const adminParam = order.adminParam || 'callpay';
    const talentName = order.talentName  || order.talentId || '-';

    // Notif ke grup agensi
    try {
      const agencyLabel = adminParam === 'admin2' ? 'SleepcallPay' : 'CallPay';
      const agencyMsg =
        `💳 <b>Pembayaran Dikonfirmasi!</b>\n\n` +
        `🏢 Agensi: <b>${agencyLabel}</b>\n` +
        `👤 Talent: <b>${talentName}</b>\n` +
        `📋 Layanan: <b>${order.service}</b>\n` +
        `⏱️ Durasi: <b>${order.duration} menit</b>\n` +
        `💰 Harga: <b>Rp ${Number(price).toLocaleString('id-ID')}</b>\n\n` +
        `🆔 ID: <code>${order_id}</code>`;
      await sendTelegramToAgency(adminParam, agencyMsg);
      console.log('Telegram agency notif sent');
    } catch(e) { console.error('Telegram agency failed:', e.message); }

    // Notif ke talent (chat pribadi)
    if (order.talentTelegramChatId) {
      try {
        const talentMsg =
          `🔔 <b>Ada Order Masuk!</b>\n\n` +
          `📋 Layanan: <b>${order.service}</b>\n` +
          `⏱️ Durasi: <b>${order.duration} menit</b>\n` +
          `💰 Harga: <b>Rp ${Number(price).toLocaleString('id-ID')}</b>\n\n` +
          `Buka portal talent untuk <b>Terima</b> atau <b>Tolak</b> dalam 2 menit!\n` +
          `👉 https://callpay.id/talent.html\n\n` +
          `🆔 ID: <code>${order_id}</code>`;
        await sendTelegramToTalent(order.talentTelegramChatId, talentMsg);
        console.log('Telegram talent notif sent to chatId:', order.talentTelegramChatId);
      } catch(e) { console.error('Telegram talent failed:', e.message); }
    } else {
      console.warn('No talentTelegramChatId in order, skipping talent notif');
    }

    return res.status(200).json({ success: true, orderId: order_id, expiredAt });

  } catch(e) {
    console.error('Webhook error:', e);
    return res.status(500).json({ error: e.message });
  }
};

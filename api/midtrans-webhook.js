// api/midtrans-webhook.js - Terima notif dari Midtrans setelah pembayaran
const { fsGet, fsSet, fromFirestore } = require('../lib/firebase');

async function sendTwilioNotif(waNumber, service, duration, price, orderId, custWa) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WA_NUMBER;

  if (!sid || !token || !from) throw new Error('Twilio ENV not set');

  let cleanNum = waNumber.toString().replace(/\D/g, '');
  if (cleanNum.startsWith('62')) cleanNum = cleanNum.slice(2);
  if (cleanNum.startsWith('0'))  cleanNum = cleanNum.slice(1);
  const to = `whatsapp:+62${cleanNum}`;

  const body = `🔔 *Ada Order Masuk!*\n\n📋 Layanan: *${service}*\n⏱️ Durasi: *${duration} menit*\n💰 Harga: *Rp ${Number(price).toLocaleString('id-ID')}*\n📱 WA Customer: *+62${custWa.replace(/^0/, '')}*\n\nBuka portal talent untuk *Terima* atau *Tolak* dalam 2 menit!\n👉 https://callpay.id/talent.html\n\nID: ${orderId}`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method : 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body   : new URLSearchParams({ From: from, To: to, Body: body }),
  });

  const twilioText = await twilioRes.text();
  console.log('Twilio response:', twilioText);
  if (!twilioRes.ok) throw new Error('Twilio error: ' + twilioText);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const notif = req.body;
    console.log('Midtrans webhook:', JSON.stringify(notif));

    const { order_id, transaction_status, fraud_status } = notif;
    if (!order_id) return res.status(400).json({ error: 'No order_id' });

    // Cek status pembayaran
    const isPaid = (
      transaction_status === 'capture' && fraud_status === 'accept'
    ) || transaction_status === 'settlement';

    if (!isPaid) {
      console.log('Payment not confirmed yet:', transaction_status);
      return res.status(200).json({ message: 'Not paid yet' });
    }

    // Ambil order dari Firestore
    const snap = await fsGet(`orders/${order_id}`);
    if (!snap || !snap.fields) return res.status(404).json({ error: 'Order not found' });
    const order = fromFirestore(snap.fields);

    // Kalau sudah pending/accepted skip
    if (order.status !== 'waiting_payment') {
      return res.status(200).json({ message: 'Already processed' });
    }

    // Update status ke pending + set timer 2 menit dari sekarang
    const expiredAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    await fsSet(`orders/${order_id}`, { ...order, status: 'pending', expiredAt, paidAt: new Date().toISOString() });

    // Kirim notif WA ke talent
    if (order.talentWa) {
      try {
        await sendTwilioNotif(order.talentWa, order.service, order.duration, order.originalPrice || order.price, order_id, order.custWa);
        console.log('Twilio notif sent to talent:', order.talentWa);
      } catch(e) {
        console.error('Twilio failed:', e.message);
      }
    } else {
      console.warn('No talentWa in order, skipping Twilio');
    }

    return res.status(200).json({ success: true, orderId: order_id, expiredAt });

  } catch(e) {
    console.error('Webhook error:', e);
    return res.status(500).json({ error: e.message });
  }
};

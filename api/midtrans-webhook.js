// api/midtrans-webhook.js - Terima notifikasi pembayaran dari Midtrans
const { fsGet, fsSet, fromFirestore } = require('../lib/firebase');
const crypto = require('crypto');

async function sendTwilioNotif(waNumber, service, duration, price, orderId) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WA_NUMBER;
  const cleanNum = waNumber.toString().replace(/^0/, '').replace(/\D/g, '');
  const to    = `whatsapp:+62${cleanNum}`;
  const body  = `🔔 *Ada Order Masuk!*\n\n📋 Layanan: *${service}*\n⏱️ Durasi: *${duration} menit*\n💰 Harga: *Rp ${Number(price).toLocaleString('id-ID')}*\n\nBuka portal talent untuk *Terima* atau *Tolak* dalam 2 menit!\n👉 https://callpay.id/talent.html\n\nID: ${orderId}`;
  const auth  = Buffer.from(`${sid}:${token}`).toString('base64');
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method : 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body   : new URLSearchParams({ From: from, To: to, Body: body }),
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const notif = req.body;
    const { order_id, transaction_status, fraud_status, signature_key, gross_amount, status_code } = notif;

    // Verifikasi signature Midtrans
    const serverKey   = process.env.MIDTRANS_SERVER_KEY;
    const expectedSig = crypto.createHash('sha512')
      .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
      .digest('hex');

    if (signature_key !== expectedSig) {
      console.error('Invalid signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Cek status pembayaran
    const isPaid = (transaction_status === 'capture' && fraud_status === 'accept') ||
                   transaction_status === 'settlement';

    if (!isPaid) {
      return res.status(200).json({ message: 'Payment not completed yet' });
    }

    // Ambil order dari Firestore
    const snap = await fsGet(`orders/${order_id}`);
    if (!snap || !snap.fields) return res.status(404).json({ error: 'Order tidak ditemukan' });
    const order = fromFirestore(snap.fields);

    if (order.status !== 'waiting_payment') {
      return res.status(200).json({ message: 'Order already processed' });
    }

    // Update status order → pending (bayar sukses, tunggu konfirmasi talent)
    const expiredAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    await fsSet(`orders/${order_id}`, {
      ...order,
      status    : 'pending',
      paidAt    : new Date().toISOString(),
      expiredAt,
    });

    // Kirim notif WA ke talent
    try {
      const tSnap = await fsGet(`talents/${order.talentId}`);
      if (tSnap && tSnap.fields) {
        const tData = fromFirestore(tSnap.fields);
        if (tData.waNumber) {
          await sendTwilioNotif(tData.waNumber, order.service, order.duration, order.originalPrice || order.price, order_id);
        }
      }
    } catch(e) { console.error('Twilio error:', e.message); }

    return res.status(200).json({ success: true });
  } catch(e) {
    console.error('Webhook error:', e);
    return res.status(500).json({ error: e.message });
  }
};

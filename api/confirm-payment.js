// api/confirm-payment.js - Konfirmasi pembayaran dari client setelah redirect Midtrans
const { fsGet, fsSet, fromFirestore } = require('../lib/firebase');


function formatDuration(minutes) {
  const m = Number(minutes);
  if (m < 60) return m + ' menit';
  const jam = m / 60;
  const jamStr = Number.isInteger(jam) ? jam.toString() : jam.toFixed(1).replace('.', ',');
  return jamStr + ' jam';
}

async function sendTwilioNotif(waNumber, service, duration, price, orderId, custWa) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WA_NUMBER;

  if (!sid || !token || !from) throw new Error('Twilio ENV not set');

  let cleanNum = waNumber.toString().replace(/\D/g, '');
  if (cleanNum.startsWith('62')) cleanNum = cleanNum.slice(2);
  if (cleanNum.startsWith('0'))  cleanNum = cleanNum.slice(1);
  const to = `whatsapp:+62${cleanNum}`;

  let cleanCust = custWa.toString().replace(/\D/g, '');
  if (cleanCust.startsWith('62')) cleanCust = cleanCust.slice(2);
  if (cleanCust.startsWith('0'))  cleanCust = cleanCust.slice(1);

  const body = `🔔 *Ada Order Masuk!*\n\n📋 Layanan: *${service}*\n⏱️ Durasi: *${formatDuration(duration)}*\n💰 Harga: *Rp ${Number(price).toLocaleString('id-ID')}*\n📱 WA Customer: *+62${cleanCust}*\n\nBuka portal talent untuk *Terima* atau *Tolak* dalam 2 menit!\n👉 https://callpay.id/talent.html\n\nID: ${orderId}`;
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId diperlukan' });

    // Ambil order dari Firestore
    const snap = await fsGet(`orders/${orderId}`);
    if (!snap || !snap.fields) return res.status(404).json({ error: 'Order tidak ditemukan' });

    const order = fromFirestore(snap.fields);

    // Kalau sudah pending/accepted/rejected — skip, tidak proses dua kali
    if (order.status !== 'waiting_payment') {
      console.log('Order already processed:', order.status);
      return res.status(200).json({ 
        success: true, 
        status: order.status,
        expiredAt: order.expiredAt,
        message: 'Already processed' 
      });
    }

    // Update status ke pending + set timer 2 menit dari sekarang
    const expiredAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const updatedOrder = { 
      ...order, 
      status: 'pending', 
      expiredAt, 
      paidAt: new Date().toISOString() 
    };
    
    await fsSet(`orders/${orderId}`, updatedOrder);
    console.log('Order confirmed:', orderId, 'expiredAt:', expiredAt);

    // Kirim notif WA ke talent
    if (order.talentWa) {
      try {
        await sendTwilioNotif(
          order.talentWa, 
          order.service, 
          order.duration, 
          order.originalPrice || order.price, 
          orderId, 
          order.custWa
        );
        console.log('Twilio notif sent to:', order.talentWa);
      } catch(e) {
        console.error('Twilio failed:', e.message);
        // Tidak gagalkan seluruh request kalau Twilio error
      }
    } else {
      console.warn('No talentWa, skipping Twilio');
    }

    return res.status(200).json({ 
      success: true, 
      status: 'pending',
      expiredAt,
      orderId
    });

  } catch(e) {
    console.error('Confirm payment error:', e);
    return res.status(500).json({ error: e.message });
  }
};

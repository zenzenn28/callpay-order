// api/order.js - Buat order baru + Midtrans payment
const { fsGet, fsSet, fromFirestore } = require('../lib/firebase');

function generateOrderId() {
  return 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
}

async function createMidtransTransaction(orderId, amount, service, duration, custWa) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) throw new Error('MIDTRANS_SERVER_KEY not set');
  const auth    = Buffer.from(serverKey + ':').toString('base64');
  const baseUrl = 'https://callpay-order-15no.vercel.app';

  const payload = {
    transaction_details: { order_id: orderId, gross_amount: Number(amount) },
    item_details: [{ id: service.toLowerCase().replace(/\s/g,'-'), price: Number(amount), quantity: 1, name: `${service} ${duration} menit` }],
    customer_details: { phone: custWa },
    callbacks: { finish: `${baseUrl}/waiting.html?orderId=${orderId}` },
  };

  const res = await fetch('https://app.sandbox.midtrans.com/snap/v1/transactions', {
    method : 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body   : JSON.stringify(payload),
  });

  const responseText = await res.text();
  console.log('Midtrans raw response:', responseText);
  if (!res.ok) throw new Error('Midtrans error: ' + responseText);
  return JSON.parse(responseText);
}


function formatDuration(minutes) {
  const m = Number(minutes);
  if (m < 60) return m + ' menit';
  const jam = m / 60;
  // Format jam: kalau bulat tampilkan angka bulat, kalau tidak bulatkan ke 1 desimal
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

  console.log('Sending WA to:', to, 'from:', from);

  const last4 = custWa.replace(/\D/g, '').slice(-4);
  const body = `🔔 *Ada Order Masuk!*\n\n📋 Layanan: *${service}*\n⏱️ Durasi: *${formatDuration(duration)}*\n💰 Harga: *Rp ${Number(price).toLocaleString('id-ID')}*\n📱 WA Customer: *xxxx-xxxx-${last4}*\n\nBuka portal talent untuk *Terima* atau *Tolak* dalam 2 menit!\n👉 https://callpay.id/talent.html\n\nID: ${orderId}`;
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
    const { talentId, talentName, talentImg, service, duration, price, custWa, note, voucherCode, adminParam } = req.body;
    if (!talentId || !service || !duration || !custWa) return res.status(400).json({ error: 'Data tidak lengkap' });

    const cleanWa = custWa.replace(/\D/g, '');
    if (cleanWa.length < 9) return res.status(400).json({ error: 'Nomor WA tidak valid' });

    // Normalize talentId ke lowercase agar cocok dengan Firestore
    const talentIdClean = talentId.toString().toLowerCase().trim();

    // Cek voucher
    let voucherData = null, finalPrice = Number(price) || 0, useVoucher = false;
    if (voucherCode && voucherCode.trim()) {
      const vCode = voucherCode.trim().toUpperCase();
      const vSnap = await fsGet(`vouchers/${vCode}`);
      if (!vSnap || !vSnap.fields) return res.status(400).json({ error: 'Kode voucher tidak valid' });
      const vData = fromFirestore(vSnap.fields);
      if (vData.used) return res.status(400).json({ error: 'Kode voucher sudah digunakan' });
      if (String(vData.service) !== String(service) || String(vData.duration) !== String(duration))
        return res.status(400).json({ error: `Voucher hanya berlaku untuk ${vData.service} ${vData.duration} menit` });
      voucherData = { code: vCode, ...vData };
      finalPrice  = 0;
      useVoucher  = true;
    }

    // Ambil WA talent
    let talentWa = null;
    try {
      console.log('Fetching talent:', talentIdClean);
      const tSnap = await fsGet(`talents/${talentIdClean}`);
      console.log('Talent snap exists:', !!tSnap?.fields);
      if (tSnap && tSnap.fields) {
        const tData = fromFirestore(tSnap.fields);
        talentWa = tData.waNumber || null;
        console.log('waNumber found:', talentWa);
      }
    } catch(e) { console.error('Fetch talent error:', e.message); }

    const orderId   = generateOrderId();
    const now       = new Date().toISOString();
    // expiredAt dihitung dari SETELAH pembayaran — di-set ulang oleh webhook Midtrans
    // Untuk voucher/gratis langsung set 2 menit dari sekarang
    const expiredAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    const orderData = {
      orderId,
      talentId   : talentIdClean,
      talentName : talentName || talentIdClean,
      talentImg  : talentImg  || '',
      service,
      duration   : String(duration),
      price      : finalPrice,
      originalPrice: Number(price) || 0,
      custWa     : cleanWa,
      note       : note || '',
      voucherCode: voucherCode || '',
      useVoucher,
      // Status 'waiting_payment' dulu, jadi timer belum jalan
      // Akan berubah jadi 'pending' setelah Midtrans webhook konfirmasi
      status     : useVoucher ? 'pending' : 'waiting_payment',
      adminParam : adminParam || 'callpay',
      createdAt  : now,
      expiredAt  : useVoucher ? expiredAt : null,
      talentWa   : talentWa || '',
    };

    await fsSet(`orders/${orderId}`, orderData);

    // Tandai voucher dipakai
    if (voucherData) {
      await fsSet(`vouchers/${voucherData.code}`, { ...voucherData, used: true, usedAt: now, usedOrder: orderId });
      // Kirim notif WA langsung kalau pakai voucher (gratis)
      if (talentWa) {
        try { await sendTwilioNotif(talentWa, service, duration, price, orderId, cleanWa); }
        catch(e) { console.error('Twilio failed:', e.message); }
      }
    }

    // Buat transaksi Midtrans (kalau bukan voucher)
    let midtransToken = null, midtransRedirectUrl = null, midtransError = null;
    if (!useVoucher && finalPrice > 0) {
      try {
        const mt = await createMidtransTransaction(orderId, finalPrice, service, duration, cleanWa);
        midtransToken = mt.token;
        midtransRedirectUrl = mt.redirect_url;
        await fsSet(`orders/${orderId}`, { ...orderData, midtransToken, midtransRedirectUrl });
      } catch(e) {
        midtransError = e.message;
        console.error('Midtrans failed:', e.message);
      }
    }

    return res.status(200).json({
      success: true,
      orderId,
      expiredAt: orderData.expiredAt,
      useVoucher,
      midtransToken,
      midtransRedirectUrl,
      price: finalPrice,
      debug: { midtransError, talentWaFound: !!talentWa }
    });

  } catch(e) {
    console.error('Order error:', e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
};

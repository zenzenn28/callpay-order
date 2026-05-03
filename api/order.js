// api/order.js - Buat order baru + Midtrans payment
const { fsGet, fsSet, fromFirestore } = require('../lib/firebase');
const { sendTelegramToAgency, sendTelegramToTalent } = require('../lib/telegram');

function generateOrderId() {
  return 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
}

const ADMIN_FEE = 3000;

async function createMidtransTransaction(orderId, amount, service, duration, custWa) {
  const serverKey   = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) throw new Error('MIDTRANS_SERVER_KEY not set');
  const auth        = Buffer.from(serverKey + ':').toString('base64');
  const baseUrl     = 'https://callpay-order-15no.vercel.app';
  const totalAmount = Number(amount) + ADMIN_FEE;

  const payload = {
    transaction_details: { order_id: orderId, gross_amount: totalAmount },
    item_details: [
      { id: service.toLowerCase().replace(/\s/g,'-'), price: Number(amount), quantity: 1, name: `${service} ${duration} menit` },
      { id: 'admin-fee', price: ADMIN_FEE, quantity: 1, name: 'Biaya Admin' },
    ],
    customer_details: { phone: custWa },
    callbacks: { finish: `${baseUrl}/waiting.html?orderId=${orderId}` },
    enabled_payments: ['qris', 'gopay', 'shopeepay', 'other_qris'],
    qris: { acquirer: 'gopay' },
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
  const jamStr = Number.isInteger(jam) ? jam.toString() : jam.toFixed(1).replace('.', ',');
  return jamStr + ' jam';
}

// Notif ke talent via Telegram (chat pribadi) — WA hanya 4 digit terakhir
async function notifTalent(telegramChatId, service, duration, orderId, custWa) {
  const last4 = custWa ? ('xxxx-xxxx-' + String(custWa).replace(/\D/g,'').slice(-4)) : '—';
  const msg =
    `🔔 <b>Ada Order Masuk!</b>\n\n` +
    `📋 Layanan: <b>${service}</b>\n` +
    `⏱️ Durasi: <b>${duration} menit</b>\n` +
    `📱 WA Customer: <b>${last4}</b>\n\n` +
    `Buka portal talent untuk <b>Terima</b> atau <b>Tolak</b> dalam 2 menit!\n` +
    `👉 https://callpay.id/talent.html\n\n` +
    `🆔 ID: <code>${orderId}</code>`;
  await sendTelegramToTalent(telegramChatId, msg);
}

// Notif ke grup agensi via Telegram — WA customer tampil full
async function notifAgency(adminParam, talentName, service, duration, price, orderId, custWa) {
  const LABELS = { admin1: 'CallPay', admin2: 'SleepcallPay', admin3: 'ScallpayZ' };
  const agencyLabel = LABELS[adminParam] || 'CallPay';
  let waDisplay = custWa ? String(custWa).replace(/\D/g,'') : '—';
  if (waDisplay.startsWith('62')) waDisplay = '0' + waDisplay.slice(2);
  const msg =
    `📥 <b>Order Baru Masuk!</b>\n\n` +
    `🏢 Agensi: <b>${agencyLabel}</b>\n` +
    `👤 Talent: <b>${talentName}</b>\n` +
    `📋 Layanan: <b>${service}</b>\n` +
    `⏱️ Durasi: <b>${duration} menit</b>\n` +
    `💰 Harga: <b>Rp ${Number(price).toLocaleString('id-ID')}</b>\n` +
    `📱 WA Customer: <b>${waDisplay}</b>\n\n` +
    `🆔 ID: <code>${orderId}</code>`;
  await sendTelegramToAgency(adminParam, msg);
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

    // Ambil data talent (WA & Telegram Chat ID)
    let talentWa = null, talentWaTelegram = null;
    try {
      console.log('Fetching talent:', talentIdClean);
      const tSnap = await fsGet(`talents/${talentIdClean}`);
      console.log('Talent snap exists:', !!tSnap?.fields);
      if (tSnap && tSnap.fields) {
        const tData = fromFirestore(tSnap.fields);
        talentWa         = tData.waNumber       || null;
        talentWaTelegram = tData.telegramChatId || null;
        console.log('waNumber found:', talentWa, '| telegramChatId:', talentWaTelegram);
      }
    } catch(e) { console.error('Fetch talent error:', e.message); }

    const orderId   = generateOrderId();
    const now       = new Date().toISOString();
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
      status     : useVoucher ? 'pending' : 'waiting_payment',
      adminParam : adminParam || 'callpay',
      createdAt  : now,
      expiredAt  : useVoucher ? expiredAt : null,
      talentWa   : talentWa || '',
      talentTelegramChatId: talentWaTelegram || '',
    };

    await fsSet(`orders/${orderId}`, orderData);

    // Tandai voucher dipakai + kirim notif (khusus order voucher/gratis)
    if (voucherData) {
      await fsSet(`vouchers/${voucherData.code}`, { ...voucherData, used: true, usedAt: now, usedOrder: orderId });
      try {
        await notifAgency(adminParam || 'admin1', talentName || talentIdClean, service, duration, price, orderId, cleanWa);
      } catch(e) { console.error('Telegram agency notif failed:', e.message); }
      if (talentWaTelegram) {
        try { await notifTalent(talentWaTelegram, service, duration, orderId, cleanWa); }
        catch(e) { console.error('Telegram talent notif failed:', e.message); }
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

// api/order.js - Buat order baru via voucher → notif Telegram
const { fsGet, fsSet, fromFirestore } = require('../lib/firebase');
const { sendTelegramToAgency, sendTelegramToTalent } = require('../lib/telegram');

function generateOrderId() {
  return 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
}

function formatDuration(minutes) {
  const m = Number(minutes);
  if (m < 60) return m + ' menit';
  const jam = m / 60;
  return (Number.isInteger(jam) ? jam : jam.toFixed(1).replace('.', ',')) + ' jam';
}

// Normalisasi nomor WA → selalu format 62xxx (tanpa +, tanpa spasi)
function normalizeWa(wa) {
  if (!wa) return '';
  let num = String(wa).replace(/\D/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  if (!num.startsWith('62')) num = '62' + num;
  return num;
}

// Notif ke talent via Telegram — WA hanya 4 digit terakhir
async function notifTalent(telegramChatId, service, duration, orderId, custWa) {
  const last4 = custWa ? ('xxxx-xxxx-' + String(custWa).slice(-4)) : '—';
  const msg =
    `🔔 <b>Ada Order Masuk!</b>\n\n` +
    `📋 Layanan: <b>${service}</b>\n` +
    `⏱️ Durasi: <b>${formatDuration(duration)}</b>\n` +
    `📱 WA Customer: <b>${last4}</b>\n\n` +
    `Buka portal talent untuk <b>Terima</b> atau <b>Tolak</b> dalam 2 menit!\n` +
    `👉 https://callpay.id/talent.html\n\n` +
    `🆔 ID: <code>${orderId}</code>`;
  await sendTelegramToTalent(telegramChatId, msg);
}

// Notif ke grup agensi via Telegram — WA customer full
async function notifAgency(adminParam, talentName, service, duration, price, orderId, custWa) {
  const LABELS = { admin1: 'CallPay', admin2: 'SleepcallPay', admin3: 'ScallpayZ' };
  const agencyLabel = LABELS[adminParam] || 'CallPay';
  let waDisplay = custWa || '—';
  if (waDisplay.startsWith('62')) waDisplay = '0' + waDisplay.slice(2);
  const msg =
    `📥 <b>Order Baru Masuk!</b>\n\n` +
    `🏢 Agensi: <b>${agencyLabel}</b>\n` +
    `👤 Talent: <b>${talentName}</b>\n` +
    `📋 Layanan: <b>${service}</b>\n` +
    `⏱️ Durasi: <b>${formatDuration(duration)}</b>\n` +
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
    const {
      talentId, talentName, talentImg,
      service, duration, price,
      custWa, note, voucherCode, adminParam
    } = req.body;

    if (!talentId || !service || !duration) {
      return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    const talentIdClean = talentId.toString().toLowerCase().trim();

    // ── Validasi voucher (wajib) ──────────────────────────────
    if (!voucherCode || !voucherCode.trim()) {
      return res.status(400).json({ error: 'Kode voucher diperlukan' });
    }
    const vCode = voucherCode.trim().toUpperCase();
    const vSnap = await fsGet(`vouchers/${vCode}`);
    if (!vSnap || !vSnap.fields) return res.status(400).json({ error: 'Kode voucher tidak valid' });
    const vData = fromFirestore(vSnap.fields);
    if (vData.used) return res.status(400).json({ error: 'Kode voucher sudah digunakan' });

    // Normalisasi WA: dari voucher (prioritas) atau dari body — selalu format 62xxx
    const rawWa   = vData.custWa || custWa || '';
    const cleanWa = normalizeWa(rawWa);

    // ── CEK COOLDOWN di server (tidak bisa di-bypass dari frontend) ──
    if (cleanWa && talentIdClean) {
      const cooldownKey = `cooldowns/${talentIdClean}_${cleanWa}`;
      try {
        const cdSnap = await fsGet(cooldownKey);
        if (cdSnap && cdSnap.fields) {
          const cdData    = fromFirestore(cdSnap.fields);
          const expiresAt = new Date(cdData.expiresAt);
          const now       = new Date();
          if (now < expiresAt) {
            const sisaMs  = expiresAt - now;
            const sisaMnt = Math.ceil(sisaMs / 60000);
            const sisaJam = Math.floor(sisaMnt / 60);
            const sisaMin = sisaMnt % 60;
            const sisaStr = sisaJam > 0
              ? `${sisaJam} jam${sisaMin > 0 ? ' ' + sisaMin + ' menit' : ''}`
              : `${sisaMnt} menit`;
            return res.status(400).json({
              error     : `Kamu masih dalam masa cooldown untuk talent ini. Tunggu ${sisaStr} lagi, atau order talent lain.`,
              cooldown  : true,
              sisaMenit : sisaMnt,
              expiresAt : cdData.expiresAt,
            });
          }
        }
      } catch(e) {
        console.error('Cooldown check error:', e.message);
        // Kalau gagal cek cooldown, tetap lanjutkan order (fail-open)
      }
    }

    // ── Ambil data talent ─────────────────────────────────────
    let talentWa = null, talentTelegramChatId = null;
    try {
      const tSnap = await fsGet(`talents/${talentIdClean}`);
      if (tSnap && tSnap.fields) {
        const tData = fromFirestore(tSnap.fields);
        talentWa             = tData.waNumber       || null;
        talentTelegramChatId = tData.telegramChatId || null;
      }
    } catch(e) { console.error('Fetch talent error:', e.message); }

    const orderId    = generateOrderId();
    const now        = new Date().toISOString();
    const expiredAt  = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const finalPrice = Number(vData.price) || Number(price) || 0;

    const orderData = {
      orderId,
      talentId   : talentIdClean,
      talentName : talentName || talentIdClean,
      talentImg  : talentImg  || '',
      service,
      duration   : String(duration),
      price      : finalPrice,
      custWa     : cleanWa,
      note       : note || '',
      voucherCode: vCode,
      useVoucher : true,
      status     : 'pending',
      adminParam : adminParam || 'admin1',
      createdAt  : now,
      expiredAt,
      talentWa             : talentWa || '',
      talentTelegramChatId : talentTelegramChatId || '',
    };

    // Simpan order & tandai voucher terpakai
    await fsSet(`orders/${orderId}`, orderData);
    await fsSet(`vouchers/${vCode}`, { ...vData, used: true, usedAt: now, usedOrder: orderId });

    // Kirim notif Telegram
    try {
      await notifAgency(adminParam || 'admin1', talentName || talentIdClean, service, duration, finalPrice, orderId, cleanWa);
    } catch(e) { console.error('Telegram agency notif failed:', e.message); }

    if (talentTelegramChatId) {
      try { await notifTalent(talentTelegramChatId, service, duration, orderId, cleanWa); }
      catch(e) { console.error('Telegram talent notif failed:', e.message); }
    }

    return res.status(200).json({
      success   : true,
      orderId,
      expiredAt,
      useVoucher: true,
      price     : finalPrice,
    });

  } catch(e) {
    console.error('Order error:', e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
};

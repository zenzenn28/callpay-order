// api/respond-order.js - Talent terima atau tolak order
const { fsGet, fsSet, fromFirestore } = require('../lib/firebase');

function generateVoucher() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'VC-';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Normalisasi nomor WA → selalu format 62xxx
function normalizeWa(wa) {
  if (!wa) return '';
  let num = String(wa).replace(/\D/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  if (!num.startsWith('62')) num = '62' + num;
  return num;
}

// Set talent online/offline di Firestore
async function setTalentOnline(talentId, online) {
  try {
    const snap = await fsGet(`talents/${talentId}`);
    if (!snap || !snap.fields) return;
    const talent = fromFirestore(snap.fields);
    await fsSet(`talents/${talentId}`, { ...talent, online });
    console.log(`Talent ${talentId} set ${online ? 'online' : 'offline'}`);
  } catch(e) {
    console.error('Set talent online error:', e.message);
  }
}

// Update poin talent di Firestore
async function updatePoint(talentId, delta, reason) {
  try {
    const snap = await fsGet(`talents/${talentId}`);
    if (!snap || !snap.fields) return;
    const talent   = fromFirestore(snap.fields);
    const current  = typeof talent.points === 'number' ? talent.points : 50;
    const newPoint = Math.min(100, Math.max(0, current + delta));
    await fsSet(`talents/${talentId}`, { ...talent, points: newPoint });

    // Simpan ke point_history
    const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'testweb-9b2f8';
    const API_KEY    = process.env.FIREBASE_API_KEY    || 'AIzaSyACJjz3XP7vbzxkeZmW_sCXKurAFXZ_vwU';
    const histId     = `ph_${Date.now()}`;
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/talents/${talentId}/point_history?documentId=${histId}&key=${API_KEY}`,
      {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ fields: {
          delta     : { integerValue: delta },
          total     : { integerValue: newPoint },
          reason    : { stringValue: reason },
          createdAt : { stringValue: new Date().toISOString() },
        }})
      }
    );
    console.log(`Point ${talentId}: ${current} → ${newPoint} (${delta > 0 ? '+' : ''}${delta}) — ${reason}`);
  } catch(e) {
    console.error('updatePoint error:', e.message);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { orderId, action, talentId } = req.body;
    if (!orderId || !action) return res.status(400).json({ error: 'Data tidak lengkap' });

    const snap = await fsGet(`orders/${orderId}`);
    if (!snap || !snap.fields) return res.status(404).json({ error: 'Order tidak ditemukan' });
    const order = fromFirestore(snap.fields);

    if (order.status !== 'pending') return res.status(400).json({ error: 'Order sudah diproses' });

    if (new Date() > new Date(order.expiredAt)) {
      await fsSet(`orders/${orderId}`, { ...order, status: 'expired' });
      if (order.talentId) await setTalentOnline(order.talentId, false);
      // Kalau expired dan pakai voucher → reset voucher agar bisa dipakai lagi
      if (order.voucherCode && order.useVoucher) {
        try {
          const vSnap = await fsGet(`vouchers/${order.voucherCode}`);
          if (vSnap && vSnap.fields) {
            const vData = fromFirestore(vSnap.fields);
            await fsSet(`vouchers/${order.voucherCode}`, {
              ...vData,
              used     : false,
              usedAt   : null,
              usedOrder: null,
            });
          }
        } catch(e) { console.error('Reset voucher on expire error:', e.message); }
      }
      return res.status(400).json({ error: 'Order sudah expired', voucherCode: order.voucherCode || null });
    }

    // Normalisasi custWa order — pastikan selalu 62xxx
    const custWaClean = normalizeWa(order.custWa);

    if (action === 'accept') {
      // Update order jadi accepted
      await fsSet(`orders/${orderId}`, { ...order, status: 'accepted', respondedAt: new Date().toISOString() });

      // +2 poin saat terima order
      await updatePoint(order.talentId, +2, 'Menerima order');

      // Activity log
      try {
        await fsSet(`activity_logs/al_${Date.now()}_a`, {
          type       : 'order_accepted',
          description: `Talent "${order.talentName || order.talentId}" menerima order`,
          detail     : `Layanan: ${order.service} · Durasi: ${order.duration} mnt · Rp ${order.price}`,
          createdAt  : new Date().toISOString()
        });
      } catch(e) {}

      // Voucher sudah ditandai `used: true` saat order dibuat di order.js
      // Tidak perlu set ulang — cukup pastikan acceptedBy tercatat
      if (order.voucherCode && order.useVoucher) {
        try {
          const vSnap = await fsGet(`vouchers/${order.voucherCode}`);
          if (vSnap && vSnap.fields) {
            const vData = fromFirestore(vSnap.fields);
            await fsSet(`vouchers/${order.voucherCode}`, {
              ...vData,
              used      : true,
              usedAt    : vData.usedAt || new Date().toISOString(),
              usedOrder : orderId,
              acceptedBy: order.talentId,
            });
          }
        } catch(e) { console.error('Update voucher on accept error:', e.message); }
      }

      // Auto offline talent — sedang dalam layanan
      if (order.talentId) await setTalentOnline(order.talentId, false);

      return res.status(200).json({
        success: true,
        status : 'accepted',
        custWa : custWaClean,
        price  : order.originalPrice || order.price || 0
      });

    } else if (action === 'reject') {
      // Update order jadi rejected
      await fsSet(`orders/${orderId}`, { ...order, status: 'rejected', respondedAt: new Date().toISOString() });

      // ── Simpan cooldown: format key pakai WA yang sudah dinormalisasi ──
      // Key: cooldowns/{talentId}_{custWa62xxx}
      if (custWaClean && order.talentId) {
        const cooldownKey = `cooldowns/${order.talentId}_${custWaClean}`;
        await fsSet(cooldownKey, {
          talentId  : order.talentId,
          custWa    : custWaClean,           // simpan dalam format 62xxx
          rejectedAt: new Date().toISOString(),
          expiresAt : new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 jam
          orderId,
        });
        console.log(`Cooldown set: ${cooldownKey} expires in 1 hour`);
      }

      // ── Reset voucher agar bisa dipakai ke talent lain ──
      let voucherCode = null;
      if (order.useVoucher && order.voucherCode) {
        try {
          const vSnap = await fsGet(`vouchers/${order.voucherCode}`);
          if (vSnap && vSnap.fields) {
            const vData = fromFirestore(vSnap.fields);
            await fsSet(`vouchers/${order.voucherCode}`, {
              ...vData,
              used     : false,
              usedAt   : null,
              usedOrder: null,
            });
          }
        } catch(e) { console.error('Reset voucher on reject error:', e.message); }
        voucherCode = order.voucherCode;
      } else {
        // Buat voucher baru kalau tidak pakai voucher sebelumnya
        voucherCode = generateVoucher();
        await fsSet(`vouchers/${voucherCode}`, {
          code     : voucherCode,
          service  : order.service,
          duration : order.duration,
          used     : false,
          createdAt: new Date().toISOString(),
          reason   : 'rejected',
          custWa   : custWaClean,
          originalOrder: orderId,
        });
      }

      // Activity log
      try {
        await fsSet(`activity_logs/al_${Date.now()}_r`, {
          type       : 'order_rejected',
          description: `Talent "${order.talentName || order.talentId}" menolak order`,
          detail     : `Layanan: ${order.service} · Voucher ${voucherCode} direset`,
          createdAt  : new Date().toISOString()
        });
      } catch(e) {}

      return res.status(200).json({ success: true, status: 'rejected', voucherCode });
    }

    return res.status(400).json({ error: 'Action tidak valid' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

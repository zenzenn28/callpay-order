// api/respond-order.js - Talent terima atau tolak order
const { fsGet, fsSet, fsQuery, fromFirestore } = require('../lib/firebase');

function generateVoucher() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'VC-';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
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
    const newPoint = Math.max(0, current + delta);
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
      // Auto offline talent kalau expired
      if (order.talentId) await setTalentOnline(order.talentId, false);
      const vCode = generateVoucher();
      await fsSet(`vouchers/${vCode}`, {
        code: vCode, service: order.service, duration: order.duration,
        used: false, createdAt: new Date().toISOString(),
        reason: 'expired', custWa: order.custWa, originalOrder: orderId,
      });
      return res.status(400).json({ error: 'Order sudah expired', voucherCode: vCode });
    }

    if (action === 'accept') {
      // Update order jadi accepted
      await fsSet(`orders/${orderId}`, { ...order, status: 'accepted', respondedAt: new Date().toISOString() });

      // +2 poin saat terima order
      await updatePoint(order.talentId, +2, 'Menerima order');

      // Kalau order pakai voucher → expired voucher tersebut
      if (order.voucherCode && order.useVoucher) {
        try {
          const vSnap = await fsGet(`vouchers/${order.voucherCode}`);
          if (vSnap && vSnap.fields) {
            const vData = fromFirestore(vSnap.fields);
            await fsSet(`vouchers/${order.voucherCode}`, {
              ...vData,
              used      : true,
              usedAt    : new Date().toISOString(),
              usedOrder : orderId,
              acceptedBy: order.talentId,
            });
          }
        } catch(e) { console.error('Expire voucher error:', e.message); }
      }

      // Auto offline talent — sedang dalam layanan
      if (order.talentId) await setTalentOnline(order.talentId, false);

      return res.status(200).json({ success: true, status: 'accepted', custWa: order.custWa, price: order.originalPrice || order.price || 0 });

    } else if (action === 'reject') {
      // Update order jadi rejected
      await fsSet(`orders/${orderId}`, { ...order, status: 'rejected', respondedAt: new Date().toISOString() });

      // Simpan cooldown: custWa + talentId tidak bisa order lagi selama 30 menit
      if (order.custWa && order.talentId) {
        const cooldownKey = `cooldowns/${order.talentId}_${order.custWa.replace(/\D/g,'')}`;
        await fsSet(cooldownKey, {
          talentId  : order.talentId,
          custWa    : order.custWa,
          rejectedAt: new Date().toISOString(),
          expiresAt : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          orderId,
        });
      }

      let voucherCode = null;

      if (order.useVoucher && order.voucherCode) {
        // Voucher reusable — tidak di-expire, bisa dipakai ke talent lain
        // Reset usedOrder agar bisa dipakai lagi
        try {
          const vSnap = await fsGet(`vouchers/${order.voucherCode}`);
          if (vSnap && vSnap.fields) {
            const vData = fromFirestore(vSnap.fields);
            await fsSet(`vouchers/${order.voucherCode}`, {
              ...vData,
              used     : false,  // reset — bisa dipakai lagi
              usedAt   : null,
              usedOrder: null,
            });
          }
        } catch(e) { console.error('Reset voucher error:', e.message); }
        voucherCode = order.voucherCode; // kembalikan kode voucher yang sama
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
          custWa   : order.custWa,
          originalOrder: orderId,
        });
      }

      return res.status(200).json({ success: true, status: 'rejected', voucherCode });
    }

    return res.status(400).json({ error: 'Action tidak valid' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

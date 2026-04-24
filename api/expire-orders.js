// api/expire-orders.js - Auto expire + cleanup order lama
const { fsSet, fsDelete, fromFirestore } = require('../lib/firebase');

function generateVoucher() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'VC-';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'callpay-28a28';
    const API_KEY    = process.env.FIREBASE_API_KEY    || 'AIzaSyBLPe_yx28LyefI856Ysxz3YEPnwA0ENFU';

    // Ambil SEMUA order (untuk expire + cleanup sekaligus)
    const queryRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${API_KEY}`,
      {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'orders' }]
          }
        })
      }
    );

    const results = await queryRes.json();
    const now     = new Date();
    let expired   = 0;
    let deleted   = 0;

    for (const item of results) {
      if (!item.document) continue;
      const docId  = item.document.name.split('/').pop();
      const fields = item.document.fields || {};

      // Parse fields
      const order = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v.stringValue   !== undefined) order[k] = v.stringValue;
        else if (v.integerValue !== undefined) order[k] = Number(v.integerValue);
        else if (v.booleanValue !== undefined) order[k] = v.booleanValue;
        else order[k] = null;
      }

      const createdAt = order.createdAt ? new Date(order.createdAt) : null;
      const expiredAt = order.expiredAt ? new Date(order.expiredAt) : null;
      const ageMin    = createdAt ? (now - createdAt) / 1000 / 60 : 9999;
      const status    = order.status || '';

      // ── EXPIRE: order pending yang sudah lewat waktu ──
      if (status === 'pending' && expiredAt && expiredAt <= now) {
        await fsSet(`orders/${docId}`, { ...order, orderId: docId, status: 'expired' });
        const vCode = generateVoucher();
        await fsSet(`vouchers/${vCode}`, {
          code: vCode, service: order.service || '', duration: order.duration || '',
          used: false, createdAt: now.toISOString(),
          reason: 'talent_timeout', custWa: order.custWa || '', originalOrder: docId,
        });
        expired++;
        continue;
      }

      // ── CLEANUP: hapus order lama ──
      let shouldDelete = false;

      if (status === 'waiting_payment' && ageMin > 30) shouldDelete = true;
      else if (status === 'pending' && ageMin > 180) shouldDelete = true;
      else if (['accepted', 'rejected', 'expired'].includes(status) && ageMin > 1440) shouldDelete = true;
      else if (['baru', 'direct', ''].includes(status) && ageMin > 10080) shouldDelete = true;

      if (shouldDelete) {
        try {
          await fsDelete(`orders/${docId}`);
          deleted++;
          console.log('Deleted old order:', docId, 'status:', status, 'age:', Math.round(ageMin), 'min');
        } catch(e) {
          console.error('Delete failed:', docId, e.message);
        }
      }
    }

    console.log(`expire-orders done: expired=${expired}, deleted=${deleted}`);
    return res.status(200).json({ success: true, expired, deleted });

  } catch(e) {
    console.error('expire-orders error:', e);
    return res.status(500).json({ error: e.message });
  }
};

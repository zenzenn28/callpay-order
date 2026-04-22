// api/expire-orders.js - Auto expire order yang sudah 2 menit
const { fsSet, fromFirestore } = require('../lib/firebase');

function generateVoucher() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'VC-';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Ambil semua order pending via REST query
    const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'callpay-28a28';
    const API_KEY    = process.env.FIREBASE_API_KEY    || 'AIzaSyBLPe_yx28LyefI856Ysxz3YEPnwA0ENFU';

    const queryRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${API_KEY}`,
      {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'orders' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'status' },
                op   : 'EQUAL',
                value: { stringValue: 'pending' }
              }
            }
          }
        })
      }
    );

    const results = await queryRes.json();
    const now     = new Date();
    let expired   = 0;

    for (const item of results) {
      if (!item.document) continue;
      const docId = item.document.name.split('/').pop();
      const fields = item.document.fields || {};

      // Parse fields manual
      const order = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v.stringValue  !== undefined) order[k] = v.stringValue;
        else if (v.integerValue !== undefined) order[k] = Number(v.integerValue);
        else if (v.booleanValue !== undefined) order[k] = v.booleanValue;
        else order[k] = null;
      }

      if (!order.expiredAt) continue;
      if (new Date(order.expiredAt) > now) continue;

      // Tandai expired
      await fsSet(`orders/${docId}`, { ...order, orderId: docId, status: 'expired' });

      // Buat voucher untuk cust
      const vCode = generateVoucher();
      await fsSet(`vouchers/${vCode}`, {
        code    : vCode,
        service : order.service  || '',
        duration: order.duration || '',
        used    : false,
        createdAt: now.toISOString(),
        reason  : 'talent_timeout',
        custWa  : order.custWa   || '',
        originalOrder: docId,
      });



      expired++;
    }

    return res.status(200).json({ success: true, expired });
  } catch(e) {
    console.error('expire-orders error:', e);
    return res.status(500).json({ error: e.message });
  }
};

// api/respond-order.js - Talent terima atau tolak order
const { fsGet, fsSet, fsQuery, fromFirestore } = require('../lib/firebase');

function generateVoucher() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'VC-';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
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
      const vCode = generateVoucher();
      await fsSet(`vouchers/${vCode}`, {
        code: vCode, service: order.service, duration: order.duration,
        used: false, createdAt: new Date().toISOString(),
        reason: 'expired', custWa: order.custWa, originalOrder: orderId,
      });
      return res.status(400).json({ error: 'Order sudah expired', voucherCode: vCode });
    }

    if (action === 'accept') {
      await fsSet(`orders/${orderId}`, { ...order, status: 'accepted', respondedAt: new Date().toISOString() });
      return res.status(200).json({ success: true, status: 'accepted', custWa: order.custWa });

    } else if (action === 'reject') {
      await fsSet(`orders/${orderId}`, { ...order, status: 'rejected', respondedAt: new Date().toISOString() });
      const vCode = generateVoucher();
      await fsSet(`vouchers/${vCode}`, {
        code: vCode, service: order.service, duration: order.duration,
        used: false, createdAt: new Date().toISOString(),
        reason: 'rejected', custWa: order.custWa, originalOrder: orderId,
      });
      return res.status(200).json({ success: true, status: 'rejected', voucherCode: vCode });
    }

    return res.status(400).json({ error: 'Action tidak valid' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

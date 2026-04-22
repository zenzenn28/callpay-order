// api/order-status.js - Cek status order (polling dari frontend)
const { fsGet, fromFirestore } = require('../lib/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  try {
    const snap = await fsGet(`orders/${orderId}`);
    if (!snap || !snap.fields) return res.status(404).json({ error: 'Order tidak ditemukan' });

    const order = fromFirestore(snap.fields);
    return res.status(200).json({
      status     : order.status,
      custWa     : order.status === 'accepted' ? order.custWa : null,
      expiredAt  : order.expiredAt,
      service    : order.service,
      duration   : order.duration,
      talentName : order.talentName,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

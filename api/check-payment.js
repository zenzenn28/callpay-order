// api/check-payment.js - Cek status payment dan return voucher code jika sudah completed
const { fsGet, fromFirestore } = require('../lib/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ status: 'error', error: 'orderId diperlukan' });

  try {
    // Cek di pending_payments dulu
    const snap = await fsGet(`pending_payments/${orderId}`);
    if (!snap || !snap.fields) {
      return res.status(200).json({ status: 'not_found' });
    }
    const data = fromFirestore(snap.fields);

    if (data.status === 'completed' && data.voucherCode) {
      return res.status(200).json({
        status      : 'completed',
        voucherCode : data.voucherCode,
        nominal     : data.nominal,
      });
    }

    return res.status(200).json({ status: data.status || 'pending' });
  } catch(e) {
    console.error('check-payment error:', e);
    return res.status(500).json({ status: 'error', error: e.message });
  }
};

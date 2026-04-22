// api/get-voucher.js - Ambil kode voucher dari order yang ditolak/expired
const { fsQuery, fromFirestore } = require('../lib/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  try {
    const vouchers = await fsQuery('vouchers', [{ field: 'originalOrder', value: orderId }]);
    if (vouchers.length > 0) {
      return res.status(200).json({ voucherCode: vouchers[0].code });
    }
    return res.status(200).json({ voucherCode: null });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

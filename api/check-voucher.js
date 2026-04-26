// api/check-voucher.js - Validasi kode voucher
const { fsGet, fromFirestore } = require('../lib/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { code } = req.query;
  if (!code) return res.status(400).json({ valid: false, error: 'Kode diperlukan' });

  try {
    const snap = await fsGet(`vouchers/${code.toUpperCase()}`);
    if (!snap || !snap.fields) return res.status(200).json({ valid: false, error: 'Voucher tidak ditemukan' });
    const data = fromFirestore(snap.fields);
    if (data.used) return res.status(200).json({ valid: false, error: 'Voucher sudah digunakan' });
    return res.status(200).json({
      valid   : true,
      service : data.service,
      duration: data.duration,
      custWa  : data.custWa || '',
    });
  } catch(e) {
    return res.status(500).json({ valid: false, error: 'Server error' });
  }
};

// api/create-payment.js - Simpan pending payment sebelum redirect ke Pak Kasir
const { fsSet } = require('../lib/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { orderId, nominal, bayar, custWa, adminParam } = req.body;
    if (!orderId || !nominal || !custWa) {
      return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    await fsSet(`pending_payments/${orderId}`, {
      orderId,
      nominal   : Number(nominal),        // nilai voucher (10rb, 20rb, dst)
      bayar     : Number(bayar || nominal), // total dibayar customer (sudah +3rb admin)
      custWa    : custWa.replace(/\D/g, ''),
      adminParam: adminParam || 'admin1',
      status    : 'pending',
      createdAt : new Date().toISOString(),
    });

    return res.status(200).json({ success: true, orderId });
  } catch(e) {
    console.error('create-payment error:', e);
    return res.status(500).json({ error: e.message });
  }
};

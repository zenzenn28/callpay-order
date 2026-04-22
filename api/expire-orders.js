// api/expire-orders.js - Auto expire order yang sudah 2 menit (dipanggil via cron)
const { fsQuery, fsGet, fsSet, fromFirestore } = require('../lib/firebase');

function generateVoucher() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'VC-';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Ambil semua order pending
    const orders = await fsQuery('orders', [{ field: 'status', value: 'pending' }]);
    const now    = new Date();
    let expired  = 0;

    for (const order of orders) {
      if (new Date(order.expiredAt) < now) {
        // Tandai expired
        await fsSet(`orders/${order.orderId}`, { ...order, status: 'expired' });

        // Buat voucher untuk cust
        const vCode = generateVoucher();
        await fsSet(`vouchers/${vCode}`, {
          code    : vCode,
          service : order.service,
          duration: order.duration,
          used    : false,
          createdAt: now.toISOString(),
          reason  : 'talent_timeout',
          custWa  : order.custWa,
          originalOrder: order.orderId,
        });

        // Set talent offline kalau tidak respons
        try {
          await fsSet(`talents/${order.talentId}`, { online: false }, true);
        } catch(e) {}

        expired++;
      }
    }

    return res.status(200).json({ success: true, expired });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

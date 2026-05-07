// api/create-payment.js - Buat Midtrans Snap token & simpan pending payment
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

    const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
    if (!SERVER_KEY) return res.status(500).json({ error: 'Server key tidak dikonfigurasi' });

    const waClean = custWa.replace(/\D/g, '');
    const totalBayar = Number(bayar || nominal);

    // ── Hit Midtrans Snap API ────────────────────────────────
    const mtRes = await fetch('https://app.midtrans.com/snap/v1/transactions', {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': 'Basic ' + Buffer.from(SERVER_KEY + ':').toString('base64'),
      },
      body: JSON.stringify({
        transaction_details: {
          order_id    : orderId,
          gross_amount: totalBayar,
        },
        customer_details: {
          phone: waClean,
        },
        item_details: [{
          id      : 'VOUCHER',
          price   : totalBayar,
          quantity: 1,
          name    : `Voucher CallPay Rp ${Number(nominal).toLocaleString('id-ID')}`,
        }],
        callbacks: {
          finish: `${process.env.BASE_URL || 'https://callpay.id'}/payment-success.html?orderId=${orderId}&wa=${waClean}`,
        },
      }),
    });

    const mtData = await mtRes.json();
    if (!mtData.token) {
      console.error('Midtrans error:', JSON.stringify(mtData));
      return res.status(500).json({ error: mtData.error_messages?.[0] || 'Gagal membuat transaksi Midtrans' });
    }

    // ── Simpan pending payment ke Firestore ──────────────────
    await fsSet(`pending_payments/${orderId}`, {
      orderId,
      nominal    : Number(nominal),
      bayar      : totalBayar,
      custWa     : waClean,
      adminParam : adminParam || 'admin1',
      status     : 'pending',
      snapToken  : mtData.token,
      createdAt  : new Date().toISOString(),
    });

    return res.status(200).json({
      success   : true,
      orderId,
      snapToken : mtData.token,
      redirectUrl: mtData.redirect_url,
    });

  } catch(e) {
    console.error('create-payment error:', e);
    return res.status(500).json({ error: e.message });
  }
};

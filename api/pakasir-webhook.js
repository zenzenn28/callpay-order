// api/pakasir-webhook.js - Terima webhook dari Pak Kasir, generate voucher otomatis
const { fsGet, fsSet, fromFirestore } = require('../lib/firebase');

function generateVoucherCode() {
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
    const { amount, order_id, project, status } = req.body;
    console.log('Pakasir webhook:', JSON.stringify(req.body));

    // Hanya proses kalau completed
    if (status !== 'completed') {
      return res.status(200).json({ received: true, note: 'status bukan completed, diabaikan' });
    }

    if (!order_id || !amount) {
      return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    // Ambil pending payment
    const snap = await fsGet(`pending_payments/${order_id}`);
    if (!snap || !snap.fields) {
      console.error('Pending payment tidak ditemukan:', order_id);
      return res.status(200).json({ received: true, note: 'pending payment tidak ditemukan' });
    }
    const pending = fromFirestore(snap.fields);

    // Validasi amount — cek dengan bayar (total dibayar termasuk admin fee)
    const expectedAmount = Number(pending.bayar || pending.nominal);
    if (Number(amount) !== expectedAmount) {
      console.error(`Amount tidak cocok: webhook=${amount}, expected=${expectedAmount}`);
      return res.status(200).json({ received: true, note: 'amount tidak cocok' });
    }

    // Kalau sudah diproses sebelumnya, skip
    if (pending.status === 'completed') {
      return res.status(200).json({ received: true, note: 'sudah diproses' });
    }

    // Generate voucher
    const voucherCode = generateVoucherCode();
    const now         = new Date().toISOString();

    await fsSet(`vouchers/${voucherCode}`, {
      code      : voucherCode,
      price     : Number(pending.nominal),  // nilai voucher (tanpa admin fee)
      used      : false,
      createdAt : now,
      reason    : 'pakasir_payment',
      custWa    : pending.custWa || '',
      orderId   : order_id,
      adminParam: pending.adminParam || 'admin1',
      createdBy : 'pakasir',
    });

    // Update pending payment jadi completed
    await fsSet(`pending_payments/${order_id}`, {
      ...pending,
      status     : 'completed',
      voucherCode,
      completedAt: now,
    });

    // Tambah ke collection orders agar muncul di log aktivitas admin
    await fsSet(`orders/${order_id}`, {
      orderId    : order_id,
      type       : 'voucher_purchase',   // tanda ini pembelian voucher, bukan order talent
      voucherCode,
      price      : Number(pending.nominal),
      bayar      : Number(pending.bayar || pending.nominal),
      custWa     : pending.custWa || '',
      adminParam : pending.adminParam || 'admin1',
      status     : 'completed',
      useVoucher : false,
      createdAt  : now,
      completedAt: now,
      talentName : '—',
      service    : 'Pembelian Voucher',
      duration   : '0',
    });

    console.log(`Voucher ${voucherCode} generated untuk order ${order_id} (Rp ${pending.nominal})`);

    // Catat ke activity log
    try {
      await fsSet(`activity_logs/al_${Date.now()}`, {
        type       : 'voucher_purchase',
        description: `Voucher dibeli via Pak Kasir`,
        detail     : `Kode: ${voucherCode} · Nominal: Rp ${Number(pending.nominal).toLocaleString('id')} · WA: ${pending.custWa||'-'}`,
        createdAt  : now,
      });
    } catch(e) { console.warn('activity log error:', e.message); }

    return res.status(200).json({ success: true, voucherCode });

  } catch(e) {
    console.error('pakasir-webhook error:', e);
    return res.status(500).json({ error: e.message });
  }
};

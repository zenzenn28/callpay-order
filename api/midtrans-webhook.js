// api/midtrans-webhook.js - Terima notifikasi dari Midtrans, generate voucher otomatis
const { fsGet, fsSet, fromFirestore } = require('../lib/firebase');
const crypto = require('crypto');

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
    const notif = req.body;
    console.log('Midtrans webhook:', JSON.stringify(notif));

    const {
      order_id,
      gross_amount,
      status_code,
      transaction_status,
      fraud_status,
      signature_key,
    } = notif;

    // ── Verifikasi signature ─────────────────────────────────
    const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
    const expectedSig = crypto
      .createHash('sha512')
      .update(order_id + status_code + gross_amount + SERVER_KEY)
      .digest('hex');

    if (signature_key !== expectedSig) {
      console.error('Signature tidak valid!');
      return res.status(403).json({ error: 'Signature tidak valid' });
    }

    // ── Hanya proses kalau payment sukses ───────────────────
    const isSuccess =
      (transaction_status === 'settlement') ||
      (transaction_status === 'capture' && fraud_status === 'accept');

    if (!isSuccess) {
      console.log(`Status ${transaction_status} — diabaikan`);
      return res.status(200).json({ received: true, note: `status ${transaction_status}, diabaikan` });
    }

    // ── Ambil pending payment ────────────────────────────────
    const snap = await fsGet(`pending_payments/${order_id}`);
    if (!snap || !snap.fields) {
      console.error('Pending payment tidak ditemukan:', order_id);
      return res.status(200).json({ received: true, note: 'pending payment tidak ditemukan' });
    }
    const pending = fromFirestore(snap.fields);

    // Idempotent — kalau sudah diproses, skip
    if (pending.status === 'completed') {
      return res.status(200).json({ received: true, note: 'sudah diproses' });
    }

    // ── Generate voucher ─────────────────────────────────────
    const voucherCode = generateVoucherCode();
    const now         = new Date().toISOString();

    await fsSet(`vouchers/${voucherCode}`, {
      code      : voucherCode,
      price     : Number(pending.nominal),
      used      : false,
      createdAt : now,
      reason    : 'midtrans_payment',
      custWa    : pending.custWa || '',
      orderId   : order_id,
      adminParam: pending.adminParam || 'admin1',
      createdBy : 'midtrans',
    });

    // Update pending payment → completed
    await fsSet(`pending_payments/${order_id}`, {
      ...pending,
      status     : 'completed',
      voucherCode,
      completedAt: now,
    });

    // Masukkan ke log orders
    await fsSet(`orders/${order_id}`, {
      orderId    : order_id,
      type       : 'voucher_purchase',
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

    // Activity log
    try {
      await fsSet(`activity_logs/al_${Date.now()}`, {
        type       : 'voucher_purchase',
        description: 'Voucher dibeli via Midtrans',
        detail     : `Kode: ${voucherCode} · Nominal: Rp ${Number(pending.nominal).toLocaleString('id')} · WA: ${pending.custWa || '-'}`,
        createdAt  : now,
      });
    } catch(e) { console.warn('activity log error:', e.message); }

    console.log(`Voucher ${voucherCode} generated untuk order ${order_id}`);
    return res.status(200).json({ success: true, voucherCode });

  } catch(e) {
    console.error('midtrans-webhook error:', e);
    return res.status(500).json({ error: e.message });
  }
};

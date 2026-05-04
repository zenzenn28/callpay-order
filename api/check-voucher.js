// api/check-voucher.js - Validasi kode voucher berdasarkan nominal
const { fsGet, fsQuery, fromFirestore } = require('../lib/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { code } = req.query;
  if (!code) return res.status(400).json({ valid: false, error: 'Kode diperlukan' });

  try {
    // Ambil voucher
    const snap = await fsGet(`vouchers/${code.toUpperCase()}`);
    if (!snap || !snap.fields) return res.status(200).json({ valid: false, error: 'Voucher tidak ditemukan' });
    const data = fromFirestore(snap.fields);
    if (data.used) return res.status(200).json({ valid: false, error: 'Voucher sudah digunakan' });

    const price = Number(data.price) || 0;

    // Ambil pricelist admin1 untuk mapping durasi per layanan
    const priceSnap = await fsGet('pricelist/admin1');
    let durMap = {}; // { NamaLayanan: durasi_menit }

    if (priceSnap && priceSnap.fields) {
      const priceData = fromFirestore(priceSnap.fields);
      // Untuk setiap layanan, cari durasi yang harganya = price
      Object.entries(priceData).forEach(([svcName, durations]) => {
        if (typeof durations === 'object') {
          const match = Object.entries(durations).find(([, p]) => Number(p) === price);
          if (match) durMap[svcName] = Number(match[0]); // durasi dalam menit
        }
      });
    }

    return res.status(200).json({
      valid   : true,
      price,
      custWa  : data.custWa || '',
      durMap,  // { 'Temen Call': 30, 'Sleepcall': 30, 'Temen Curhat': 20, ... }
    });
  } catch(e) {
    console.error('check-voucher error:', e);
    return res.status(500).json({ valid: false, error: 'Server error' });
  }
};

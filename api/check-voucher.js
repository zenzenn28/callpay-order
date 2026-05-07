// api/check-voucher.js - Validasi kode voucher berdasarkan nominal
const { fsGet, fromFirestore } = require('../lib/firebase');

// Normalisasi nomor WA → selalu format 62xxx
function normalizeWa(wa) {
  if (!wa) return '';
  let num = String(wa).replace(/\D/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  if (!num.startsWith('62')) num = '62' + num;
  return num;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { code } = req.query;
  if (!code) return res.status(400).json({ valid: false, error: 'Kode diperlukan' });

  try {
    const snap = await fsGet(`vouchers/${code.toUpperCase()}`);
    if (!snap || !snap.fields) return res.status(200).json({ valid: false, error: 'Voucher tidak ditemukan' });
    const data = fromFirestore(snap.fields);
    if (data.used) return res.status(200).json({ valid: false, error: 'Voucher sudah digunakan' });

    const price = Number(data.price) || 0;

    // Normalisasi custWa → 62xxx agar konsisten dengan cooldown key
    const custWaClean = normalizeWa(data.custWa);

    // Ambil pricelist untuk mapping durasi per layanan
    const priceSnap = await fsGet('pricelist/admin1');
    let durMap = {};

    if (priceSnap && priceSnap.fields) {
      const priceData = fromFirestore(priceSnap.fields);
      Object.entries(priceData).forEach(([svcName, durations]) => {
        if (typeof durations === 'object') {
          const match = Object.entries(durations).find(([, p]) => Number(p) === price);
          if (match) durMap[svcName] = Number(match[0]);
        }
      });
    }

    return res.status(200).json({
      valid    : true,
      price,
      custWa   : custWaClean,   // selalu 62xxx — dipakai untuk cooldown key
      durMap,
    });
  } catch(e) {
    console.error('check-voucher error:', e);
    return res.status(500).json({ valid: false, error: 'Server error' });
  }
};

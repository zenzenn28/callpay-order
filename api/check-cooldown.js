// api/check-cooldown.js - Cek apakah customer masih dalam cooldown untuk talent tertentu
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
  const { talentId, custWa } = req.query;
  if (!talentId || !custWa) return res.status(400).json({ cooldown: false });

  try {
    // Normalisasi WA agar key-nya selalu konsisten
    const waClean = normalizeWa(custWa);
    const key     = `cooldowns/${talentId.toLowerCase().trim()}_${waClean}`;
    const snap    = await fsGet(key);

    if (!snap || !snap.fields) return res.status(200).json({ cooldown: false });

    const data      = fromFirestore(snap.fields);
    const expiresAt = new Date(data.expiresAt);
    const now       = new Date();

    if (now < expiresAt) {
      const sisaMs  = expiresAt - now;
      const sisaMnt = Math.ceil(sisaMs / 60000);
      const sisaJam = Math.floor(sisaMnt / 60);
      const sisaMin = sisaMnt % 60;
      return res.status(200).json({
        cooldown  : true,
        sisaMenit : sisaMnt,
        sisaJam   : sisaJam,
        sisaMin   : sisaMin,
        expiresAt : data.expiresAt,
      });
    }

    // Cooldown sudah lewat
    return res.status(200).json({ cooldown: false });

  } catch(e) {
    console.error('check-cooldown error:', e);
    return res.status(200).json({ cooldown: false });
  }
};

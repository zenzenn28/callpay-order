// api/check-cooldown.js - Cek apakah customer masih dalam cooldown untuk talent tertentu
const { fsGet, fromFirestore } = require('../lib/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { talentId, custWa } = req.query;
  if (!talentId || !custWa) return res.status(400).json({ cooldown: false });

  try {
    const waClean = custWa.replace(/\D/g, '');
    const key     = `cooldowns/${talentId}_${waClean}`;
    const snap    = await fsGet(key);

    if (!snap || !snap.fields) return res.status(200).json({ cooldown: false });

    const data      = fromFirestore(snap.fields);
    const expiresAt = new Date(data.expiresAt);
    const now       = new Date();

    if (now < expiresAt) {
      const sisaMs  = expiresAt - now;
      const sisaMnt = Math.ceil(sisaMs / 60000);
      return res.status(200).json({
        cooldown  : true,
        sisaMenit : sisaMnt,
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

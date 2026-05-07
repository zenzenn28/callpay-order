// api/check-blacklist.js - Cek apakah customer di-blacklist (talent atau global)
const { fsGet, fromFirestore } = require('../lib/firebase');

function normalizeWa(wa) {
  if (!wa) return '';
  let num = String(wa).replace(/\D/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  if (!num.startsWith('62')) num = '62' + num;
  return num;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { talentId, custWa, global: isGlobal } = req.query;
  if (!custWa) return res.status(400).json({ blocked: false });

  const waClean = normalizeWa(custWa);
  if (!waClean) return res.status(200).json({ blocked: false });

  try {
    // Cek blacklist global (dari admin) — tidak bisa order siapapun
    const globalSnap = await fsGet(`blacklist_global/${waClean}`);
    if (globalSnap && globalSnap.fields) {
      const gData = fromFirestore(globalSnap.fields);
      if (gData.active !== false) {
        return res.status(200).json({ blocked: true, type: 'global' });
      }
    }

    // Kalau hanya cek global, stop di sini
    if (isGlobal === '1') {
      return res.status(200).json({ blocked: false });
    }

    // Cek blacklist talent — tidak bisa order talent ini saja
    if (talentId) {
      const talentIdClean = talentId.toLowerCase().trim();
      const talentBlSnap  = await fsGet(`talents/${talentIdClean}/blacklist/${waClean}`);
      if (talentBlSnap && talentBlSnap.fields) {
        return res.status(200).json({ blocked: true, type: 'talent' });
      }
    }

    return res.status(200).json({ blocked: false });

  } catch(e) {
    console.error('check-blacklist error:', e);
    return res.status(200).json({ blocked: false }); // fail-open
  }
};

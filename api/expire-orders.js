// api/expire-orders.js - Auto expire + cleanup order lama + auto offline talent + reset periode gaji
const { fsSet, fsGet, fsDelete, fsQuery, fromFirestore } = require('../lib/firebase');

function generateVoucher() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'VC-';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function setTalentOnline(talentId, online) {
  try {
    const snap = await fsGet(`talents/${talentId}`);
    if (!snap || !snap.fields) return;
    const talent = fromFirestore(snap.fields);
    await fsSet(`talents/${talentId}`, { ...talent, online });
  } catch(e) { console.error('Set talent online error:', e.message); }
}

function getPeriodId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = date.getDate();
  if (d >= 5 && d <= 20) return `${y}-${m}-1`;
  if (d > 20) return `${y}-${m}-2`;
  // d < 5: periode dari bulan sebelumnya
  const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const py   = prev.getFullYear();
  const pm   = String(prev.getMonth() + 1).padStart(2, '0');
  return `${py}-${pm}-2`;
}

function getPeriodLabel(date) {
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  if (d >= 5 && d <= 20) return `5–20 ${months[m]} ${y}`;
  if (d > 20) {
    const nm = (m + 1) % 12;
    const ny = nm === 0 ? y + 1 : y;
    return `21 ${months[m]}–4 ${months[nm]} ${ny}`;
  }
  const pm = (m - 1 + 12) % 12;
  const py = m === 0 ? y - 1 : y;
  return `21 ${months[pm]}–4 ${months[m]} ${y}`;
}

async function checkAndResetPeriod(now) {
  const day = now.getDate();
  // Hanya jalankan reset di tgl 5 atau tgl 20
  if (day !== 5 && day !== 20) return;

  const currentPeriodId = getPeriodId(now);
  const resetKey        = `period_reset_${currentPeriodId}`;

  // Cek apakah sudah pernah reset periode ini
  try {
    const existing = await fsGet(`settings/${resetKey}`);
    if (existing && existing.fields) {
      console.log('Period already reset:', currentPeriodId);
      return;
    }
  } catch(e) {}

  console.log('Starting period reset for:', currentPeriodId);

  // Ambil semua talent approved
  const talents = await fsQuery('talents', [{ field: 'status', value: 'approved' }]);

  for (const talent of talents) {
    try {
      // Ambil semua order accepted talent ini
      const orders = await fsQuery('orders', [
        { field: 'talentId', value: talent.id },
        { field: 'status',   value: 'accepted' }
      ]);

      // Hitung gaji periode yang baru selesai
      let totalGross = 0;
      const orderIds = [];
      for (const order of orders) {
        totalGross += Number(order.originalPrice || order.price || 0);
        orderIds.push(order.orderId || order.id);
      }

      if (totalGross > 0) {
        const totalNet  = Math.round(totalGross * 0.6);
        const prevLabel = getPeriodLabel(new Date(now.getFullYear(), now.getMonth(), day === 5 ? 4 : 19));
        const docId     = `${talent.id}_${getPeriodId(new Date(now.getFullYear(), now.getMonth(), day === 5 ? 4 : 19))}`;

        // Simpan rekap gaji ke salary_periods
        await fsSet(`salary_periods/${docId}`, {
          talentId   : talent.id,
          talentName : talent.name || talent.id,
          periodId   : getPeriodId(new Date(now.getFullYear(), now.getMonth(), day === 5 ? 4 : 19)),
          periodLabel: prevLabel,
          totalGross,
          totalNet,
          orderIds,
          status    : 'pending',
          paidAt    : null,
          createdAt : now.toISOString(),
        });

        console.log(`Saved salary for ${talent.id}: Rp ${totalNet}`);
      }

      // Hapus semua order accepted/rejected/expired talent ini
      const allOrders = await fsQuery('orders', [{ field: 'talentId', value: talent.id }]);
      for (const order of allOrders) {
        if (['accepted', 'rejected', 'expired'].includes(order.status)) {
          await fsDelete(`orders/${order.orderId || order.id}`);
        }
      }

    } catch(e) {
      console.error(`Reset period error for talent ${talent.id}:`, e.message);
    }
  }

  // Tandai sudah reset
  await fsSet(`settings/${resetKey}`, { resetAt: now.toISOString(), periodId: currentPeriodId });
  console.log('Period reset done:', currentPeriodId);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'callpay-28a28';
    const API_KEY    = process.env.FIREBASE_API_KEY    || 'AIzaSyBLPe_yx28LyefI856Ysxz3YEPnwA0ENFU';
    const now        = new Date();

    // Cek reset periode dulu
    await checkAndResetPeriod(now);

    // Ambil semua order
    const queryRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${API_KEY}`,
      {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ structuredQuery: { from: [{ collectionId: 'orders' }] } })
      }
    );

    const results = await queryRes.json();
    let expired = 0, deleted = 0;

    for (const item of results) {
      if (!item.document) continue;
      const docId  = item.document.name.split('/').pop();
      const fields = item.document.fields || {};
      const order  = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v.stringValue   !== undefined) order[k] = v.stringValue;
        else if (v.integerValue !== undefined) order[k] = Number(v.integerValue);
        else if (v.booleanValue !== undefined) order[k] = v.booleanValue;
        else order[k] = null;
      }

      const createdAt = order.createdAt ? new Date(order.createdAt) : null;
      const expiredAt = order.expiredAt ? new Date(order.expiredAt) : null;
      const ageMin    = createdAt ? (now - createdAt) / 1000 / 60 : 9999;
      const status    = order.status || '';

      // EXPIRE pending yang sudah lewat waktu
      if (status === 'pending' && expiredAt && expiredAt <= now) {
        await fsSet(`orders/${docId}`, { ...order, orderId: docId, status: 'expired' });
        if (order.talentId) await setTalentOnline(order.talentId, false);
        const vCode = generateVoucher();
        await fsSet(`vouchers/${vCode}`, {
          code: vCode, service: order.service || '', duration: order.duration || '',
          used: false, createdAt: now.toISOString(),
          reason: 'talent_timeout', custWa: order.custWa || '', originalOrder: docId,
        });
        expired++;
        continue;
      }

      // CLEANUP order lama
      let shouldDelete = false;
      if (status === 'waiting_payment' && ageMin > 30) shouldDelete = true;
      else if (status === 'pending' && ageMin > 180) shouldDelete = true;
      else if (['accepted','rejected','expired'].includes(status) && ageMin > 1440) shouldDelete = true;
      else if (['baru','direct',''].includes(status) && ageMin > 10080) shouldDelete = true;

      if (shouldDelete) {
        try { await fsDelete(`orders/${docId}`); deleted++; } catch(e) {}
      }
    }

    return res.status(200).json({ success: true, expired, deleted });
  } catch(e) {
    console.error('expire-orders error:', e);
    return res.status(500).json({ error: e.message });
  }
};

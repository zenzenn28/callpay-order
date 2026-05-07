// order-patch.js - Flow baru: Voucher dulu, baru pilih layanan

const API_BASE        = 'https://callpay-order-15no.vercel.app';
let _activeVoucherCode = '';
let _voucherData       = null; // simpan data voucher yang valid
const MIDTRANS_CLIENT  = 'Mid-client-Endj0wHvJambaZCs';

// Normalisasi WA → 62xxx (konsisten dengan server)
function normalizeWa(wa) {
  if (!wa) return '';
  let num = String(wa).replace(/\D/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  if (!num.startsWith('62')) num = '62' + num;
  return num;
}

// Format WA untuk display → 08xxx
function displayWa(wa) {
  const num = normalizeWa(wa);
  if (!num) return '';
  if (num.startsWith('62')) return '0' + num.slice(2);
  return num;
}

// Load Midtrans Snap
(function() {
  const s = document.createElement('script');
  s.src = 'https://app.sandbox.midtrans.com/snap/snap.js';
  s.setAttribute('data-client-key', MIDTRANS_CLIENT);
  document.head.appendChild(s);
})();

// ── INJECT MODAL (ganti total isi modal-scroll) ──────────────
function injectModalFields() {
  // Kalau sudah diinjeksi, skip
  if (document.getElementById('vc-section')) return;

  const scroll = document.querySelector('#order-modal .modal-scroll');
  if (!scroll) return;

  // Sisipkan konten baru setelah .modal-talent-strip
  const talentStrip = scroll.querySelector('.modal-talent-strip');
  if (!talentStrip) return;

  // ── SECTION VOUCHER ──
  const vcSection = document.createElement('div');
  vcSection.id = 'vc-section';
  vcSection.innerHTML = `
    <div style="margin-bottom:4px;font-size:.7rem;font-weight:900;color:rgba(240,235,248,.5);text-transform:uppercase;letter-spacing:.06em">Masukkan Kode Voucher</div>
    <div style="font-size:.75rem;color:rgba(240,235,248,.35);font-weight:600;margin-bottom:10px">Masukkan kode voucher yang kamu beli dari admin.</div>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <input type="text" id="modal-voucher" placeholder="Kode voucher"
        style="flex:1;padding:10px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#F0EBF8;font-family:'Nunito',sans-serif;font-size:16px;font-weight:600;outline:none;text-transform:uppercase;transition:border-color .2s;min-width:0"
        oninput="this.value=this.value.toUpperCase()">
      <button id="btn-gunakan" onclick="window.checkVoucher()"
        style="padding:10px 14px;border-radius:10px;background:transparent;border:2px solid #FFB800;color:#FFB800;font-family:'Nunito',sans-serif;font-weight:900;font-size:.82rem;cursor:pointer;white-space:nowrap;transition:all .2s;flex-shrink:0"
        onmouseover="this.style.background='rgba(255,184,0,.1)'" onmouseout="this.style.background='transparent'">
        Gunakan
      </button>
    </div>
    <div id="voucher-msg" style="display:none;border-radius:10px;padding:10px 12px;margin-bottom:4px"></div>
  `;
  talentStrip.insertAdjacentElement('afterend', vcSection);

  // ── SECTION LAYANAN (hidden dulu) ──
  const svcSection = document.createElement('div');
  svcSection.id = 'svc-section';
  svcSection.style.display = 'none';
  svcSection.innerHTML = `
    <div style="margin-top:14px;margin-bottom:6px;font-size:.7rem;font-weight:900;color:rgba(240,235,248,.5);text-transform:uppercase;letter-spacing:.06em">Pilih Layanan</div>
    <div id="svc-list" style="display:flex;flex-direction:column;gap:6px"></div>
    <div style="margin-top:14px;margin-bottom:6px;font-size:.72rem;font-weight:900;color:rgba(240,235,248,.5);text-transform:uppercase;letter-spacing:.06em">Catatan (opsional)</div>
    <textarea id="modal-note" rows="2" placeholder="Ceritakan apa yang kamu inginkan..."
      style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#F0EBF8;font-family:'Nunito',sans-serif;font-size:16px;font-weight:600;padding:8px 12px;outline:none;resize:none;transition:border-color .2s"></textarea>
  `;
  vcSection.insertAdjacentElement('afterend', svcSection);

  // ── TOMBOL PESAN ──
  const btnWrap = document.createElement('div');
  btnWrap.style.cssText = 'margin-top:12px';
  btnWrap.innerHTML = `
    <button id="modal-wa-btn" disabled
      style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#E8628A,#F9A8C9);color:#fff;border:none;padding:12px;border-radius:12px;font-size:.88rem;font-weight:800;transition:opacity .2s,transform .2s;box-shadow:0 4px 18px rgba(232,98,138,.3);cursor:not-allowed;opacity:.4;font-family:'Nunito',sans-serif">
      🎀 Pesan Sekarang
    </button>
    <div id="btn-hint" style="text-align:center;margin-top:8px;font-size:.75rem;font-weight:700;color:rgba(240,235,248,.35)">
      🔒 Masukkan kode voucher untuk melanjutkan
    </div>
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.06);text-align:center;font-size:.78rem;font-weight:700;color:rgba(240,235,248,.35)">
      Belum punya voucher? <a id="beli-disini-link" href="#" style="color:#FFB800;font-weight:900;text-decoration:underline;text-underline-offset:3px" onclick="belDisini(event)">Beli di sini</a>
    </div>
  `;
  svcSection.insertAdjacentElement('afterend', btnWrap);

  // Pasang event tombol
  document.getElementById('modal-wa-btn').addEventListener('click', doOrder);
}

// ── BELI VOUCHER shortcut ────────────────────────────────────
window.belDisini = function(e) {
  if (e) e.preventDefault();
  const modal = document.getElementById("order-modal");
  if (modal) modal.classList.remove("open");
  const admin = window._adminParam || "admin1";
  const base  = window.location.href.replace(/[^/]*$/, "");
  window.location.href = base + "beli-voucher.html?admin=" + admin;
};

// ── RESET modal ke state awal ────────────────────────────────
function resetModal() {
  _activeVoucherCode = '';
  _voucherData       = null;

  const vcInput = document.getElementById('modal-voucher');
  if (vcInput) vcInput.value = '';

  const msg = document.getElementById('voucher-msg');
  if (msg) { msg.style.display = 'none'; msg.innerHTML = ''; }

  const svcSection = document.getElementById('svc-section');
  if (svcSection) svcSection.style.display = 'none';

  const noteEl = document.getElementById('modal-note');
  if (noteEl) noteEl.value = '';

  const btn = document.getElementById('modal-wa-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '.4'; btn.style.cursor = 'not-allowed'; }

  const hint = document.getElementById('btn-hint');
  if (hint) { hint.style.display = 'block'; hint.textContent = '🔒 Masukkan kode voucher untuk melanjutkan'; }

  // Unlock input voucher
  if (vcInput) { vcInput.readOnly = false; vcInput.style.opacity = '1'; }
  const btnGunakan = document.getElementById('btn-gunakan');
  if (btnGunakan) { btnGunakan.disabled = false; btnGunakan.style.opacity = '1'; }
}

// ── CEK VOUCHER ──────────────────────────────────────────────
window.checkVoucher = async function() {
  const code    = document.getElementById('modal-voucher')?.value?.trim().toUpperCase();
  const msg     = document.getElementById('voucher-msg');
  const btnGun  = document.getElementById('btn-gunakan');
  if (!code) return;

  // Loading state
  msg.style.display = 'block';
  msg.style.background = 'rgba(255,255,255,.04)';
  msg.style.border = '1px solid rgba(255,255,255,.08)';
  msg.innerHTML = '<span style="color:rgba(240,235,248,.5);font-size:.82rem;font-weight:700">⏳ Mengecek voucher...</span>';
  if (btnGun) { btnGun.disabled = true; btnGun.style.opacity = '.5'; }

  try {
    const res  = await fetch(`${API_BASE}/api/check-voucher?code=${code}`);
    const data = await res.json();

    if (data.valid) {
      _activeVoucherCode = code;
      _voucherData       = data;

      // Format nomor WA untuk display (08xxx) — data.custWa sudah 62xxx dari server
      const waDisplay = displayWa(data.custWa);

      // Tampilkan status berhasil
      msg.style.background = 'rgba(61,214,140,.06)';
      msg.style.border      = '1px solid rgba(61,214,140,.25)';
      msg.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="width:32px;height:32px;border-radius:50%;background:#3DD68C;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:.9rem">✓</div>
          <div>
            <div style="font-size:.9rem;font-weight:900;color:#3DD68C">Voucher Berhasil!</div>
            <div style="font-size:.75rem;color:rgba(240,235,248,.5);font-weight:600">Berikut detail voucher kamu.</div>
          </div>
        </div>
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;overflow:hidden">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.06)">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:28px;height:28px;border-radius:8px;background:rgba(167,139,250,.15);display:flex;align-items:center;justify-content:center;font-size:.85rem">🎫</span>
              <span style="font-size:.82rem;font-weight:700;color:rgba(240,235,248,.7)">Saldo Voucher</span>
            </div>
            <span style="font-size:.88rem;font-weight:900;color:#a78bfa">Rp ${Number(data.price||0).toLocaleString('id-ID')}</span>
          </div>
          ${waDisplay ? `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:28px;height:28px;border-radius:8px;background:rgba(37,211,102,.15);display:flex;align-items:center;justify-content:center;font-size:.85rem">📱</span>
              <span style="font-size:.82rem;font-weight:700;color:rgba(240,235,248,.7)">Nomor WhatsApp</span>
            </div>
            <span style="font-size:.82rem;font-weight:800;color:#F0EBF8">${waDisplay}</span>
          </div>` : ''}
        </div>
      `;

      // Cek cooldown untuk talent ini
      const talentIdStr = String(window.activeTalent?._docId || window.activeTalent?.id || '').toLowerCase().trim();
      const waForCd     = normalizeWa(data.custWa);   // selalu 62xxx agar cocok dengan key di Firestore
      if (talentIdStr && waForCd) {
        try {
          const cdRes  = await fetch(`${API_BASE}/api/check-cooldown?talentId=${encodeURIComponent(talentIdStr)}&custWa=${encodeURIComponent(waForCd)}`);
          const cdData = await cdRes.json();
          if (cdData.cooldown) {
            const sisaJam = Math.floor(cdData.sisaMenit / 60);
            const sisaMnt = cdData.sisaMenit % 60;
            const sisaStr = sisaJam > 0 ? `${sisaJam} jam${sisaMnt > 0 ? ' ' + sisaMnt + ' menit' : ''}` : `${cdData.sisaMenit} menit`;
            msg.style.background = 'rgba(255,184,0,.06)';
            msg.style.border      = '1px solid rgba(255,184,0,.25)';
            msg.style.display     = 'block';
            msg.innerHTML = `
              <div style="font-size:.82rem;font-weight:800;color:#FFB800;margin-bottom:4px">⏳ Talent ini menolak orderanmu</div>
              <div style="font-size:.78rem;font-weight:600;color:rgba(240,235,248,.6)">Tunggu <b style="color:#FFB800">${sisaStr}</b> sebelum order ke talent ini lagi, atau pilih talent lain.</div>
            `;
            if (btnGun) { btnGun.disabled = false; btnGun.style.opacity = '1'; }
            return; // stop — jangan tampilkan pilihan layanan
          }
        } catch(e) { /* lanjut kalau gagal cek */ }
      }

      // Kunci input voucher
      const vcInput = document.getElementById('modal-voucher');
      if (vcInput) { vcInput.readOnly = true; vcInput.style.opacity = '.5'; }
      if (btnGun)  { btnGun.disabled = true; btnGun.style.opacity = '.4'; }

      // Render pilihan layanan
      renderServiceList(data);

      // Tampilkan section layanan
      const svcSection = document.getElementById('svc-section');
      if (svcSection) svcSection.style.display = 'block';

      // Hint berubah
      const hint = document.getElementById('btn-hint');
      if (hint) hint.style.display = 'none';

    } else {
      // Voucher tidak valid
      msg.style.background = 'rgba(255,92,92,.06)';
      msg.style.border      = '1px solid rgba(255,92,92,.25)';
      msg.innerHTML = `<span style="color:#FF5C5C;font-size:.82rem;font-weight:700">❌ ${data.error || 'Voucher tidak valid atau sudah digunakan.'}</span>`;
      if (btnGun) { btnGun.disabled = false; btnGun.style.opacity = '1'; }
    }
  } catch(e) {
    msg.style.background = 'rgba(255,92,92,.06)';
    msg.style.border      = '1px solid rgba(255,92,92,.25)';
    msg.innerHTML = `<span style="color:#FF5C5C;font-size:.82rem;font-weight:700">❌ Gagal terhubung ke server.</span>`;
    if (btnGun) { btnGun.disabled = false; btnGun.style.opacity = '1'; }
  }
};

// Format durasi: ≤90 menit → "X menit", >90 → "X jam" atau "X jam Y menit"
function formatDur(menit) {
  const m = Number(menit);
  if (m <= 90) return m + ' menit';
  const jam  = Math.floor(m / 60);
  const sisa = m % 60;
  return sisa > 0 ? `${jam} jam ${sisa} menit` : `${jam} jam`;
}

// ── RENDER PILIHAN LAYANAN ───────────────────────────────────
function renderServiceList(voucherData) {
  const list = document.getElementById('svc-list');
  if (!list) return;

  const talent   = window.activeTalent;
  const services = (talent?.services || []).filter(s => !(talent?.lockedServices||[]).includes(s));

  // durMap: { 'Temen Call': 30, 'Sleepcall': 30, 'Temen Curhat': 20, ... }
  const durMap = voucherData.durMap || {};

  const ICONS = {
    'Sleepcall'    : '🌙',
    'Temen Call'   : '📞',
    'Temen Curhat' : '🫂',
    'Pacar Virtual': '💕',
    'Video Call'   : '📹',
  };

  list.innerHTML = '';
  let firstSelected = false;

  services.forEach(svc => {
    // Hanya tampilkan layanan yang ada durasi di durMap
    const dur = durMap[svc];
    if (!dur) return; // layanan ini tidak tersedia di nominal voucher ini

    const icon    = ICONS[svc] || '🎯';
    const key     = window.SVC_LABEL_TO_KEY?.[svc] || svc.toLowerCase().replace(/\s+/g,'-');
    const selected = !firstSelected; // pre-select yang pertama
    if (selected) firstSelected = true;

    const row = document.createElement('div');
    row.className    = 'svc-row-item';
    row.dataset.svc  = key;
    row.dataset.svcLabel = svc;
    row.dataset.dur  = dur;
    row.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:2px solid ${selected ? 'rgba(167,139,250,.6)' : 'rgba(255,255,255,.08)'};background:${selected ? 'rgba(167,139,250,.08)' : 'rgba(255,255,255,.03)'};cursor:pointer;transition:all .2s`;

    row.innerHTML = `
      <span style="font-size:1.2rem;flex-shrink:0">${icon}</span>
      <span style="flex:1;font-size:.85rem;font-weight:800">${svc}</span>
      <span style="font-size:.78rem;font-weight:700;padding:4px 10px;border-radius:99px;background:rgba(255,255,255,.08);color:rgba(240,235,248,.6)">${dur} menit</span>
      <div style="width:22px;height:22px;border-radius:50%;border:2px solid ${selected ? '#a78bfa' : 'rgba(255,255,255,.2)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${selected ? '#a78bfa' : 'transparent'}">
        ${selected ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M2 6l3 3 5-5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/></svg>' : ''}
      </div>
    `;

    row.addEventListener('click', () => selectService(row, key, svc, dur));
    list.appendChild(row);
  });

  if (!list.children.length) {
    list.innerHTML = '<div style="font-size:.82rem;color:rgba(240,235,248,.4);font-weight:600;padding:8px 0">Tidak ada layanan tersedia untuk voucher ini di talent ini.</div>';
  }

  if (firstSelected) {
    // Set selected state untuk row pertama
    const firstRow = list.querySelector('.svc-row-item');
    if (firstRow) {
      _selectedSvc      = firstRow.dataset.svc;
      _selectedSvcLabel = firstRow.dataset.svcLabel;
      _selectedDur      = Number(firstRow.dataset.dur);
      enableOrderBtn();
    }
  }
}

// ── PILIH LAYANAN ────────────────────────────────────────────
let _selectedSvc = '';
let _selectedSvcLabel = '';
let _selectedDur = 0;

function selectService(el, key, label, dur) {
  _selectedDur = Number(dur) || 0;
  // Reset semua row
  document.querySelectorAll('.svc-row-item').forEach(r => {
    r.style.border     = '2px solid rgba(255,255,255,.08)';
    r.style.background = 'rgba(255,255,255,.03)';
    const dot = r.querySelector('div:last-child');
    if (dot) { dot.style.border = '2px solid rgba(255,255,255,.2)'; dot.style.background = 'transparent'; dot.innerHTML = ''; }
  });

  // Aktifkan yang dipilih
  el.style.border     = '2px solid rgba(167,139,250,.6)';
  el.style.background = 'rgba(167,139,250,.08)';
  const dot = el.querySelector('div:last-child');
  if (dot) {
    dot.style.border     = '2px solid #a78bfa';
    dot.style.background = '#a78bfa';
    dot.innerHTML        = '<svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M2 6l3 3 5-5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  }

  _selectedSvc      = key;
  _selectedSvcLabel = label;
  enableOrderBtn();
}

function enableOrderBtn() {
  const btn  = document.getElementById('modal-wa-btn');
  const hint = document.getElementById('btn-hint');
  if (btn)  { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
  if (hint) hint.style.display = 'none';
}

// ── SUBMIT ORDER ─────────────────────────────────────────────
async function doOrder() {
  const talent  = window.activeTalent;
  const note    = document.getElementById('modal-note')?.value?.trim() || '';
  const voucher = _activeVoucherCode;
  const vd      = _voucherData;

  if (!talent)       { alert('Pilih talent dulu!'); return; }
  if (!voucher)      { alert('Masukkan kode voucher terlebih dahulu!'); return; }
  if (!_selectedSvc) { alert('Pilih layanan terlebih dahulu!'); return; }

  const svcLabel = _selectedSvcLabel;
  const durInt   = _selectedDur || 0;
  const price    = Number(vd?.price) || 0;
  const custWa   = normalizeWa(vd?.custWa);   // selalu 62xxx

  const btn = document.getElementById('modal-wa-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }

  // Cek cooldown — hanya berlaku untuk talent yang sama
  if (custWa) {
    try {
      const talentIdStr = String(talent._docId || talent.id).toLowerCase().trim();
      const cdRes  = await fetch(`${API_BASE}/api/check-cooldown?talentId=${encodeURIComponent(talentIdStr)}&custWa=${encodeURIComponent(custWa)}`);
      const cdData = await cdRes.json();
      if (cdData.cooldown) {
        if (btn) { btn.disabled = false; btn.textContent = '🎀 Pesan Sekarang'; }
        const sisaJam  = Math.floor(cdData.sisaMenit / 60);
        const sisaMnt  = cdData.sisaMenit % 60;
        const sisaStr  = sisaJam > 0 ? `${sisaJam} jam ${sisaMnt > 0 ? sisaMnt + ' menit' : ''}` : `${cdData.sisaMenit} menit`;
        const msgEl = document.getElementById('voucher-msg');
        if (msgEl) {
          msgEl.style.display    = 'block';
          msgEl.style.background = 'rgba(255,184,0,.06)';
          msgEl.style.border     = '1px solid rgba(255,184,0,.25)';
          msgEl.innerHTML = `
            <div style="font-size:.82rem;font-weight:800;color:#FFB800;margin-bottom:4px">⏳ Talent ini menolak orderanmu</div>
            <div style="font-size:.78rem;font-weight:600;color:rgba(240,235,248,.6)">Tunggu <b style="color:#FFB800">${sisaStr.trim()}</b> sebelum order ke talent ini lagi, atau pilih talent lain.</div>
          `;
        }
        return;
      }
    } catch(e) { /* Kalau gagal cek, lanjut saja */ }
  }

  try {
    const res = await fetch(`${API_BASE}/api/order`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        talentId   : String(talent._docId || talent.id),
        talentName : talent.name,
        talentImg  : talent.img || '',
        service    : svcLabel,
        duration   : durInt,
        price,
        custWa,
        note,
        voucherCode: voucher,
        adminParam : window._adminParam || 'admin1',
      })
    });

    const data = await res.json();

    if (!data.success) {
      if (btn) { btn.disabled = false; btn.textContent = '🎀 Pesan Sekarang'; }

      // Jika server return cooldown error → tampilkan pesan cooldown, bukan alert
      if (data.cooldown) {
        const sisaJam = Math.floor((data.sisaMenit || 60) / 60);
        const sisaMin = (data.sisaMenit || 60) % 60;
        const sisaStr = sisaJam > 0
          ? `${sisaJam} jam${sisaMin > 0 ? ' ' + sisaMin + ' menit' : ''}`
          : `${data.sisaMenit || 60} menit`;
        const msgEl = document.getElementById('voucher-msg');
        if (msgEl) {
          msgEl.style.display    = 'block';
          msgEl.style.background = 'rgba(255,184,0,.06)';
          msgEl.style.border     = '1px solid rgba(255,184,0,.25)';
          msgEl.innerHTML = `
            <div style="font-size:.82rem;font-weight:800;color:#FFB800;margin-bottom:4px">⏳ Talent ini menolak orderanmu</div>
            <div style="font-size:.78rem;font-weight:600;color:rgba(240,235,248,.6)">Tunggu <b style="color:#FFB800">${sisaStr}</b> sebelum order ke talent ini lagi, atau pilih talent lain.</div>
          `;
        }
        return;
      }

      alert('Gagal: ' + (data.error || 'Terjadi kesalahan'));
      return;
    }

    // Tutup modal & arahkan ke waiting page
    const modal = document.getElementById('order-modal');
    if (modal) modal.classList.remove('open');

    const waitUrl = `${API_BASE}/waiting.html` +
      `?orderId=${encodeURIComponent(data.orderId)}` +
      `&talentName=${encodeURIComponent(talent.name)}` +
      `&talentImg=${encodeURIComponent(talent.img||'')}` +
      `&voucherCode=${encodeURIComponent(voucher)}` +
      `&home=${encodeURIComponent(window.location.href)}`;

    window.location.href = waitUrl;

  } catch(e) {
    console.error('Order error:', e);
    alert('Gagal terhubung ke server: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Pesan Sekarang'; }
  }
}

// ── HOOK ke openModal ────────────────────────────────────────
function applyOverride() {
  const _origOpenModal = window.openModal;

  window.openModal = function(id) {
    // Panggil openModal asli — isi window.activeTalent, modal-img, modal-tname, buka modal
    if (_origOpenModal) _origOpenModal(id);

    // window.activeTalent diset oleh openModal asli
    if (!window.activeTalent) return;

    // Inject form voucher (hanya sekali, sisipkan setelah talent strip)
    injectModalFields();

    // Reset ke state awal setiap kali modal dibuka
    resetModal();
  };
}

// Apply setelah DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyOverride);
} else {
  applyOverride();
}

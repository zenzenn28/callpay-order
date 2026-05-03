// order-patch.js - Flow baru: Voucher dulu, baru pilih layanan

const API_BASE        = 'https://callpay-order-15no.vercel.app';
let _activeVoucherCode = '';
let _voucherData       = null; // simpan data voucher yang valid
const MIDTRANS_CLIENT  = 'Mid-client-Endj0wHvJambaZCs';

// Load Midtrans Snap
(function() {
  const s = document.createElement('script');
  s.src = 'https://app.sandbox.midtrans.com/snap/snap.js';
  s.setAttribute('data-client-key', MIDTRANS_CLIENT);
  document.head.appendChild(s);
})();

// ── INJECT MODAL (ganti total isi modal-scroll) ──────────────
function injectModalFields() {
  if (document.getElementById('patch-injected')) return;

  const scroll = document.querySelector('#order-modal .modal-scroll');
  if (!scroll) return;

  // Tandai sudah diinjeksi
  scroll.setAttribute('id', 'patch-injected');

  // Ambil elemen talent strip yang sudah ada
  const talentStrip = scroll.querySelector('.modal-talent-strip');

  // Kosongkan isi modal-scroll, tapi simpan talent strip & head
  const modalHead = scroll.querySelector('.modal-head');
  scroll.innerHTML = '';
  if (modalHead)    scroll.appendChild(modalHead);
  if (talentStrip)  scroll.appendChild(talentStrip);

  // ── SECTION VOUCHER ──
  const vcSection = document.createElement('div');
  vcSection.id = 'vc-section';
  vcSection.innerHTML = `
    <div style="margin-bottom:6px;font-size:.72rem;font-weight:900;color:rgba(240,235,248,.5);text-transform:uppercase;letter-spacing:.06em">Masukkan Kode Voucher</div>
    <div style="font-size:.78rem;color:rgba(240,235,248,.35);font-weight:600;margin-bottom:12px">Masukkan kode voucher yang kamu beli dari admin.</div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input type="text" id="modal-voucher" placeholder="Masukkan kode voucher"
        style="flex:1;padding:11px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#F0EBF8;font-family:'Nunito',sans-serif;font-size:.9rem;font-weight:600;outline:none;text-transform:uppercase;transition:border-color .2s"
        oninput="this.value=this.value.toUpperCase()">
      <button id="btn-gunakan" onclick="window.checkVoucher()"
        style="padding:11px 18px;border-radius:10px;background:transparent;border:2px solid #FFB800;color:#FFB800;font-family:'Nunito',sans-serif;font-weight:900;font-size:.88rem;cursor:pointer;white-space:nowrap;transition:all .2s"
        onmouseover="this.style.background='rgba(255,184,0,.1)'" onmouseout="this.style.background='transparent'">
        Gunakan
      </button>
    </div>
    <div id="voucher-msg" style="display:none;border-radius:12px;padding:14px 16px;margin-bottom:4px"></div>
  `;
  scroll.appendChild(vcSection);

  // ── SECTION LAYANAN (hidden dulu) ──
  const svcSection = document.createElement('div');
  svcSection.id = 'svc-section';
  svcSection.style.display = 'none';
  svcSection.innerHTML = `
    <div style="margin-top:18px;margin-bottom:8px;font-size:.72rem;font-weight:900;color:rgba(240,235,248,.5);text-transform:uppercase;letter-spacing:.06em">Pilih Layanan</div>
    <div id="svc-list" style="display:flex;flex-direction:column;gap:8px"></div>
    <div style="margin-top:14px;margin-bottom:6px;font-size:.72rem;font-weight:900;color:rgba(240,235,248,.5);text-transform:uppercase;letter-spacing:.06em">Catatan (opsional)</div>
    <textarea id="modal-note" rows="2" placeholder="Ceritakan apa yang kamu inginkan..."
      style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#F0EBF8;font-family:'Nunito',sans-serif;font-size:.9rem;font-weight:600;padding:10px 14px;outline:none;resize:vertical;transition:border-color .2s"></textarea>
  `;
  scroll.appendChild(svcSection);

  // ── TOMBOL PESAN ──
  const btnWrap = document.createElement('div');
  btnWrap.style.cssText = 'margin-top:16px';
  btnWrap.innerHTML = `
    <button id="modal-wa-btn" disabled
      style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#25D366;color:#fff;border:none;padding:13px;border-radius:12px;font-size:.95rem;font-weight:800;transition:opacity .2s,transform .2s;box-shadow:0 4px 18px rgba(37,211,102,.3);cursor:not-allowed;opacity:.4;font-family:'Nunito',sans-serif">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="20" height="20" fill="white"><path d="M24 4C13 4 4 13 4 24c0 3.6 1 7 2.7 9.9L4 44l10.4-2.7C17.2 43 20.5 44 24 44c11 0 20-9 20-20S35 4 24 4zm0 36c-3.1 0-6.1-.8-8.7-2.4l-.6-.4-6.2 1.6 1.7-6-.4-.6C8.8 30.1 8 27.1 8 24 8 15.2 15.2 8 24 8s16 7.2 16 16-7.2 16-16 16zm8.7-11.8c-.5-.2-2.8-1.4-3.2-1.5-.4-.2-.7-.2-1 .2-.3.4-1.2 1.5-1.4 1.8-.3.3-.5.4-1 .1-.5-.2-2-.7-3.8-2.3-1.4-1.2-2.3-2.8-2.6-3.2-.3-.5 0-.7.2-1 .2-.2.5-.5.7-.8.2-.3.3-.5.4-.8.1-.3 0-.6-.1-.8-.1-.2-1-2.5-1.4-3.4-.4-.9-.8-.8-1-.8h-.9c-.3 0-.8.1-1.2.6-.4.5-1.6 1.6-1.6 3.8s1.7 4.4 1.9 4.7c.2.3 3.3 5.1 8.1 7.1 1.1.5 2 .8 2.7 1 1.1.3 2.2.3 3 .2.9-.1 2.8-1.1 3.2-2.2.4-1.1.4-2 .3-2.2-.2-.3-.5-.4-1-.6z"/></svg>
      Pesan Sekarang
    </button>
    <div id="btn-hint" style="text-align:center;margin-top:8px;font-size:.75rem;font-weight:700;color:rgba(240,235,248,.35)">
      🔒 Masukkan kode voucher untuk melanjutkan
    </div>
  `;
  scroll.appendChild(btnWrap);

  // Pasang event tombol
  document.getElementById('modal-wa-btn').addEventListener('click', doOrder);
}

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

      // Format nomor WA
      let waDisplay = data.custWa ? data.custWa.toString().replace(/\D/g,'') : '';
      if (waDisplay.startsWith('62')) waDisplay = '0' + waDisplay.slice(2);

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

// ── RENDER PILIHAN LAYANAN ───────────────────────────────────
function renderServiceList(voucherData) {
  const list = document.getElementById('svc-list');
  if (!list) return;

  const talent   = window.activeTalent;
  const services = (talent?.services || []).filter(s => !(talent?.lockedServices||[]).includes(s));

  // Ikon per layanan
  const ICONS = {
    'Sleepcall'    : '🌙',
    'Temen Call'   : '📞',
    'Temen Curhat' : '🫂',
    'Pacar Virtual': '💕',
    'Video Call'   : '📹',
  };

  // Durasi dari voucher (dalam menit)
  const voucherDur = Number(voucherData.duration) || 0;

  list.innerHTML = '';
  let firstSelected = false;

  services.forEach(svc => {
    const icon    = ICONS[svc] || '🎯';
    const key     = window.SVC_LABEL_TO_KEY?.[svc] || svc.toLowerCase().replace(/\s+/g,'-');
    const isMatch = voucherData.service && svc.toLowerCase() === voucherData.service.toLowerCase();

    // Pre-select layanan yang sesuai voucher
    const selected = isMatch && !firstSelected;
    if (selected) firstSelected = true;

    const row = document.createElement('div');
    row.className    = 'svc-row-item';
    row.dataset.svc  = key;
    row.dataset.svcLabel = svc;
    row.style.cssText = `display:flex;align-items:center;gap:12px;padding:13px 16px;border-radius:12px;border:2px solid ${selected ? 'rgba(167,139,250,.6)' : 'rgba(255,255,255,.08)'};background:${selected ? 'rgba(167,139,250,.08)' : 'rgba(255,255,255,.03)'};cursor:pointer;transition:all .2s`;

    row.innerHTML = `
      <span style="font-size:1.2rem;flex-shrink:0">${icon}</span>
      <span style="flex:1;font-size:.9rem;font-weight:800">${svc}</span>
      ${voucherDur ? `<span style="font-size:.78rem;font-weight:700;padding:4px 10px;border-radius:99px;background:rgba(255,255,255,.08);color:rgba(240,235,248,.6)">${voucherDur} menit</span>` : ''}
      <div style="width:22px;height:22px;border-radius:50%;border:2px solid ${selected ? '#a78bfa' : 'rgba(255,255,255,.2)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${selected ? '#a78bfa' : 'transparent'}">
        ${selected ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M2 6l3 3 5-5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/></svg>' : ''}
      </div>
    `;

    row.addEventListener('click', () => selectService(row, key, svc));
    list.appendChild(row);
  });

  // Jika ada pre-select, aktifkan tombol pesan
  if (firstSelected) {
    enableOrderBtn();
  }
}

// ── PILIH LAYANAN ────────────────────────────────────────────
let _selectedSvc = '';
let _selectedSvcLabel = '';

function selectService(el, key, label) {
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

  if (!talent)  { alert('Pilih talent dulu!'); return; }
  if (!voucher) { alert('Masukkan kode voucher terlebih dahulu!'); return; }
  if (!_selectedSvc) { alert('Pilih layanan terlebih dahulu!'); return; }

  const svcLabel = _selectedSvcLabel;
  const durInt   = Number(vd?.duration) || 0;
  const price    = Number(vd?.price)    || 0;

  // Nomor WA dari voucher
  let custWa = vd?.custWa ? vd.custWa.toString().replace(/\D/g,'') : '';

  const btn = document.getElementById('modal-wa-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }

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
        adminParam : window._adminParam || 'callpay',
      })
    });

    const data = await res.json();

    if (!data.success) {
      alert('Gagal: ' + (data.error || 'Terjadi kesalahan'));
      if (btn) { btn.disabled = false; btn.textContent = 'Pesan Sekarang'; }
      return;
    }

    // Tutup modal
    const modal = document.getElementById('order-modal');
    if (modal) modal.classList.remove('open');

    const waitUrl = `${API_BASE}/waiting.html` +
      `?orderId=${encodeURIComponent(data.orderId)}` +
      `&talentName=${encodeURIComponent(talent.name)}` +
      `&talentImg=${encodeURIComponent(talent.img||'')}` +
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
    // Panggil openModal asli dulu (isi talent strip, dll)
    if (_origOpenModal) _origOpenModal(id);

    // Inject field baru (hanya sekali)
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

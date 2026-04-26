// order-patch.js - Override confirmViaWA dengan sistem order baru + Midtrans

const API_BASE        = 'https://callpay-order-15no.vercel.app';
const MIDTRANS_CLIENT = 'Mid-client-Endj0wHvJambaZCs';

// Load Midtrans Snap
(function() {
  const s = document.createElement('script');
  s.src = 'https://app.sandbox.midtrans.com/snap/snap.js';
  s.setAttribute('data-client-key', MIDTRANS_CLIENT);
  document.head.appendChild(s);
})();

function applyOverride() {
  injectModalFields();

  // Unlock semua field yang dikunci voucher
function unlockVoucherFields() {
  const waEl  = document.getElementById('modal-cust-wa');
  const svcEl = document.getElementById('modal-service');
  const durEl = document.getElementById('modal-duration');
  const stat  = document.getElementById('voucher-status');
  const vcEl  = document.getElementById('modal-voucher');
  if (waEl)  { waEl.readOnly  = false; waEl.style.opacity  = '1'; waEl.style.cursor = ''; }
  if (svcEl) { svcEl.disabled = false; svcEl.style.opacity = '1'; }
  if (durEl) { durEl.disabled = false; durEl.style.opacity = '1'; }
  if (stat)  { stat.style.display = 'none'; stat.textContent = ''; }
  if (vcEl)  { vcEl.value = ''; }
}

window.confirmViaWA = async function() {
    const talent  = window.activeTalent;
    const svcEl   = document.getElementById('modal-service');
    const durEl   = document.getElementById('modal-duration');
    const svcRaw  = svcEl?.value || '';
    const durRaw  = durEl?.value || '';
    const note    = document.getElementById('modal-note')?.value    || '';
    const custWa  = document.getElementById('modal-cust-wa')?.value?.trim() || '';
    const voucher = document.getElementById('modal-voucher')?.value?.trim()  || '';

    if (!talent)  { alert('Pilih talent dulu!'); return; }
    if (!svcRaw)  { alert('Pilih layanan dulu!'); return; }
    if (!durRaw)  { alert('Pilih durasi dulu!'); return; }
    if (!custWa)  { alert('Masukkan nomor WhatsApp kamu dulu!'); document.getElementById('modal-cust-wa')?.focus(); return; }

    const checked = document.getElementById('admin-fee-check')?.checked;
    if (!checked) { alert('Centang persetujuan biaya admin terlebih dahulu!'); return; }

    const svcLabel = window.SVC_KEY_TO_LABEL?.[svcRaw] || svcRaw;
    const durInt   = parseInt(durRaw);
    const price    = window.PRICES?.[svcLabel]?.[durInt] || 0;

    console.log('Order:', { talent: talent.name, svcRaw, svcLabel, durRaw, durInt, price, custWa });

    const btn = document.getElementById('modal-wa-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }

    try {
      const res = await fetch(`${API_BASE}/api/order`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          talentId  : String(talent._docId || talent.id),
          talentName: talent.name,
          talentImg : talent.img || '',
          service   : svcLabel,
          duration  : durInt,
          price,
          custWa,
          note,
          voucherCode: voucher,
          adminParam : window._adminParam || 'callpay',
        })
      });

      const data = await res.json();
      console.log('Response:', data);

      if (!data.success) {
        alert('Gagal: ' + (data.error || 'Terjadi kesalahan'));
        if (btn) { btn.disabled = false; btn.textContent = 'Lanjut ke Pembayaran'; }
        return;
      }

      // Tutup modal
      const modal = document.getElementById('order-modal');
      if (modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }

      const waitUrl = `${API_BASE}/waiting.html` +
        `?orderId=${encodeURIComponent(data.orderId)}` +
        `&talentName=${encodeURIComponent(talent.name)}` +
        `&talentImg=${encodeURIComponent(talent.img||'')}` +
        `&home=${encodeURIComponent(window.location.href)}`;

      if (data.useVoucher || !data.midtransToken) {
        window.location.href = waitUrl;
      } else {
        window.snap.pay(data.midtransToken, {
          onSuccess: () => { window.location.href = waitUrl + '&paid=1'; },
          onPending: () => { window.location.href = waitUrl + '&paid=1'; },
          onError  : () => { alert('Pembayaran gagal. Coba lagi.'); if (btn) { btn.disabled = false; btn.textContent = 'Lanjut ke Pembayaran'; } },
          onClose  : () => { if (btn) { btn.disabled = false; btn.textContent = 'Lanjut ke Pembayaran'; } },
        });
      }
    } catch(e) {
      console.error('Order error:', e);
      alert('Gagal terhubung ke server: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Lanjut ke Pembayaran'; }
    }
  };
}

function injectModalFields() {
  unlockVoucherFields();
  if (document.getElementById('modal-cust-wa')) return;
  const noteEl = document.getElementById('modal-note');
  if (!noteEl) return;

  const waWrap = document.createElement('div');
  waWrap.style.cssText = 'margin-bottom:14px';
  waWrap.innerHTML = `
    <label style="display:block;font-size:.72rem;font-weight:800;color:rgba(240,235,248,.5);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">NOMOR WHATSAPP KAMU *</label>
    <input type="tel" id="modal-cust-wa" placeholder="Contoh: 08123456789"
      style="width:100%;padding:10px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#F0EBF8;font-family:'Nunito',sans-serif;font-size:.9rem;font-weight:600;outline:none">`;
  noteEl.parentElement?.insertBefore(waWrap, noteEl.parentElement.firstChild);

  const vcWrap = document.createElement('div');
  vcWrap.style.cssText = 'margin-bottom:14px';
  vcWrap.innerHTML = `
    <label style="display:block;font-size:.72rem;font-weight:800;color:rgba(240,235,248,.5);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">KODE VOUCHER (OPSIONAL)</label>
    <div style="display:flex;gap:8px">
      <input type="text" id="modal-voucher" placeholder="Contoh: VC-ABC12345"
        style="flex:1;padding:10px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#F0EBF8;font-family:'Nunito',sans-serif;font-size:.9rem;font-weight:600;outline:none;text-transform:uppercase">
      <button onclick="window.checkVoucher()" style="padding:10px 14px;border-radius:10px;background:rgba(255,184,0,.1);border:1px solid rgba(255,184,0,.3);color:#FFB800;font-family:'Nunito',sans-serif;font-weight:800;font-size:.82rem;cursor:pointer;white-space:nowrap">Gunakan</button>
    </div>
    <div id="voucher-status" style="font-size:.75rem;font-weight:700;margin-top:4px;display:none"></div>`;
  waWrap.after(vcWrap);

  const waBtn = document.getElementById('modal-wa-btn');
  if (waBtn) waBtn.innerHTML = 'Lanjut ke Pembayaran';
}

window.checkVoucher = async function() {
  const code = document.getElementById('modal-voucher')?.value?.trim().toUpperCase();
  const stat = document.getElementById('voucher-status');
  if (!code || !stat) return;
  stat.style.display = 'block';
  stat.style.color   = 'rgba(240,235,248,.5)';
  stat.textContent   = 'Mengecek voucher...';
  try {
    const res  = await fetch(`${API_BASE}/api/check-voucher?code=${code}`);
    const data = await res.json();
    if (data.valid) {
      stat.style.color = '#3DD68C';
      stat.textContent = `Voucher valid! ${data.service} ${data.duration} menit - GRATIS`;

      // Auto centang checkbox admin fee
      const adminCheck = document.getElementById('admin-fee-check');
      if (adminCheck) {
        adminCheck.checked = true;
        adminCheck.dispatchEvent(new Event('change'));
      }

      // Kunci nomor WA dan layanan agar tidak bisa diubah
      const waEl  = document.getElementById('modal-cust-wa');
      const svcEl = document.getElementById('modal-service');
      const durEl = document.getElementById('modal-duration');
      if (waEl)  { waEl.readOnly  = true; waEl.style.opacity  = '.6'; waEl.style.cursor = 'not-allowed'; }
      if (svcEl) { svcEl.disabled = true; svcEl.style.opacity = '.6'; }
      if (durEl) { durEl.disabled = true; durEl.style.opacity = '.6'; }

      // AUTO-FILL form berdasarkan data voucher
      autoFillVoucher(data);
    } else {
      stat.style.color = '#FF5C5C';
      stat.textContent = data.error || 'Voucher tidak valid';
    }
  } catch(e) {
    stat.style.color = '#FF5C5C';
    stat.textContent = 'Gagal cek voucher';
  }
};

// Auto-fill form berdasarkan data voucher
function autoFillVoucher(data) {
  // Auto-fill nomor WA customer kalau ada di voucher
  if (data.custWa) {
    const waEl = document.getElementById('modal-cust-wa');
    if (waEl && !waEl.value) {
      let num = data.custWa.toString().replace(/\D/g, '');
      if (num.startsWith('62')) num = '0' + num.slice(2);
      waEl.value = num;
    }
  }

  // Set layanan
  const svcEl = document.getElementById('modal-service');
  if (svcEl && data.service) {
    // Cari option yang cocok (case insensitive)
    for (const opt of svcEl.options) {
      const label = window.SVC_KEY_TO_LABEL?.[opt.value] || opt.value;
      if (label.toLowerCase() === data.service.toLowerCase() || opt.value.toLowerCase() === data.service.toLowerCase()) {
        svcEl.value = opt.value;
        svcEl.dispatchEvent(new Event('change'));
        break;
      }
    }
  }

  // Set durasi setelah layanan dipilih (butuh delay karena durasi di-render ulang)
  setTimeout(() => {
    const durEl = document.getElementById('modal-duration');
    if (durEl && data.duration) {
      for (const opt of durEl.options) {
        if (String(opt.value) === String(data.duration)) {
          durEl.value = opt.value;
          durEl.dispatchEvent(new Event('change'));
          break;
        }
      }
    }
  }, 300);
}

// Apply override setelah DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyOverride);
} else {
  applyOverride();
}

// Observer inject field saat modal muncul
new MutationObserver(() => {
  injectModalFields();
  applyOverride();
}).observe(document.body, { childList: true, subtree: true });

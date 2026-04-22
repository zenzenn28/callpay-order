// order-patch.js - Patch modal order dengan WA, voucher, dan Midtrans Snap
// Pasang di index.html sebelum </body>:
// <script src="https://YOUR-VERCEL-URL.vercel.app/order-patch.js"></script>

const API_BASE = 'https://callpay-order-15no.vercel.app'; 
const MIDTRANS_CLIENT = 'Mid-client-87ffSwFJ7TbDZVeD';

// Load Midtrans Snap
(function() {
  const s = document.createElement('script');
  s.src = 'https://app.midtrans.com/snap/snap.js';
  s.setAttribute('data-client-key', MIDTRANS_CLIENT);
  document.head.appendChild(s);
})();

window.confirmViaWA = async function() {
  const talent  = window.activeTalent;
  const svcRaw  = document.getElementById('modal-service')?.value;
  const durRaw  = document.getElementById('modal-duration')?.value;
  const note    = document.getElementById('modal-note')?.value    || '';
  const custWa  = document.getElementById('modal-cust-wa')?.value?.trim() || '';
  const voucher = document.getElementById('modal-voucher')?.value?.trim()  || '';

  if (!talent || !svcRaw || !durRaw) { alert('Lengkapi pilihan layanan dan durasi!'); return; }
  if (!custWa) { alert('Masukkan nomor WhatsApp kamu dulu!'); document.getElementById('modal-cust-wa')?.focus(); return; }
  const checked = document.getElementById('admin-fee-check')?.checked;
  if (!checked) { alert('Centang persetujuan biaya admin terlebih dahulu!'); return; }

  const svcLabel = window.SVC_KEY_TO_LABEL?.[svcRaw] || svcRaw;
  const price    = window.PRICES?.[svcLabel]?.[parseInt(durRaw)] || 0;

  const btn = document.getElementById('modal-wa-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }

  try {
    const res  = await fetch(`${API_BASE}/api/order`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        talentId  : String(talent._docId || talent.id),
        talentName: talent.name,
        talentImg : talent.img || '',
        service   : svcLabel,
        duration  : parseInt(durRaw),
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
      if (btn) { btn.disabled = false; btn.textContent = 'Lanjut ke Pembayaran'; }
      return;
    }

    // Tutup modal
    const modal = document.getElementById('modal-overlay');
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
        onSuccess: () => { window.location.href = waitUrl; },
        onPending: () => { window.location.href = waitUrl; },
        onError  : () => { alert('Pembayaran gagal. Coba lagi.'); if (btn) { btn.disabled = false; btn.textContent = 'Lanjut ke Pembayaran'; } },
        onClose  : () => { if (btn) { btn.disabled = false; btn.textContent = 'Lanjut ke Pembayaran'; } },
      });
    }
  } catch(e) {
    alert('Gagal terhubung ke server. Coba lagi.');
    if (btn) { btn.disabled = false; btn.textContent = 'Lanjut ke Pembayaran'; }
  }
};

function injectModalFields() {
  if (document.getElementById('modal-cust-wa')) return;
  const noteEl = document.getElementById('modal-note');
  if (!noteEl) return;

  const waWrap = document.createElement('div');
  waWrap.style.cssText = 'margin-bottom:14px';
  waWrap.innerHTML = `
    <label style="display:block;font-size:.72rem;font-weight:800;color:rgba(240,235,248,.5);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">NOMOR WHATSAPP KAMU *</label>
    <input type="tel" id="modal-cust-wa" placeholder="Contoh: 08123456789"
      style="width:100%;padding:10px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#F0EBF8;font-family:'Nunito',sans-serif;font-size:.9rem;font-weight:600;outline:none"
      oninput="updateWaBtn()">`;
  noteEl.parentElement?.insertBefore(waWrap, noteEl.parentElement.firstChild);

  const vcWrap = document.createElement('div');
  vcWrap.style.cssText = 'margin-bottom:14px';
  vcWrap.innerHTML = `
    <label style="display:block;font-size:.72rem;font-weight:800;color:rgba(240,235,248,.5);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">KODE VOUCHER (OPSIONAL)</label>
    <div style="display:flex;gap:8px">
      <input type="text" id="modal-voucher" placeholder="Contoh: VC-ABC12345"
        style="flex:1;padding:10px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#F0EBF8;font-family:'Nunito',sans-serif;font-size:.9rem;font-weight:600;outline:none;text-transform:uppercase">
      <button onclick="checkVoucher()" style="padding:10px 14px;border-radius:10px;background:rgba(255,184,0,.1);border:1px solid rgba(255,184,0,.3);color:#FFB800;font-family:'Nunito',sans-serif;font-weight:800;font-size:.82rem;cursor:pointer;white-space:nowrap">Gunakan</button>
    </div>
    <div id="voucher-status" style="font-size:.75rem;font-weight:700;margin-top:4px;display:none"></div>`;
  waWrap.after(vcWrap);

  const waBtn = document.getElementById('modal-wa-btn');
  if (waBtn) waBtn.innerHTML = 'Lanjut ke Pembayaran';
}

window.updateWaBtn = function() {
  const wa    = document.getElementById('modal-cust-wa')?.value?.trim() || '';
  const check = document.getElementById('admin-fee-check');
  const btn   = document.getElementById('modal-wa-btn');
  if (btn) btn.disabled = !(wa.length >= 9 && (!check || check.checked));
};

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
    } else {
      stat.style.color = '#FF5C5C';
      stat.textContent = data.error || 'Voucher tidak valid';
    }
  } catch(e) {
    stat.style.color = '#FF5C5C';
    stat.textContent = 'Gagal cek voucher';
  }
};

new MutationObserver(() => injectModalFields()).observe(document.body, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', injectModalFields);

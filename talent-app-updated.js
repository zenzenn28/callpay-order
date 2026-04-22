// ============================================================
//  CALLPAY — TALENT APP v4
//  - Tab Orderanku dihapus
//  - Sistem point otomatis: online 1 jam +1 (maks 250), tidak online/order sehari -3
//  - Point history (klik point box → lihat riwayat + alasan)
//  - Admin bisa tulis alasan saat ubah point
// ============================================================
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot,
         collection, addDoc, getDocs, orderBy, query, limit,
         serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';
import { DB, DUR_LABEL } from './admin/data.js';

const FIREBASE_CONFIG = {
  apiKey:'AIzaSyBLPe_yx28LyefI856Ysxz3YEPnwA0ENFU',
  authDomain:'callpay-28a28.firebaseapp.com',
  projectId:'callpay-28a28',
  storageBucket:'callpay-28a28.firebasestorage.app',
  messagingSenderId:'44722427776',
  appId:'1:44722427776:web:29d1a297746cd83d685365'
};
const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
const db  = getFirestore(app);

const CLOUDINARY_CLOUD  = 'dnbjw43hp';
const CLOUDINARY_PRESET = 'callpay_audio';
let ALL_SERVICES = ['Temen Call','Sleepcall','Temen Curhat','Pacar Virtual','Video Call']; // default, akan diupdate dari Firestore

async function loadServicesForTalent() {
  try {
    const { collection, onSnapshot } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js');
    onSnapshot(collection(db, 'services'), snap => {
      const svcs = [];
      snap.forEach(d => svcs.push({ id: d.id, ...d.data() }));
      svcs.sort((a,b) => (a.order||99) - (b.order||99));
      ALL_SERVICES = svcs.map(s => s.name);
      // Re-render settings panel kalau sedang terbuka
      const settingsEl = document.getElementById('settings-content');
      if (settingsEl && settingsEl.innerHTML) renderSettingsPanel();
    });
  } catch(e) { console.warn('Gagal load services untuk talent:', e); }
}
const SESSION_KEY  = 'cp_talent_v2';
const POINT_MAX    = 250;

let currentTalent    = null;
let _docId           = null;
let _uploadedAudioUrl = '';
let _uploadedPhotoUrl = '';

// ── SESSION ───────────────────────────────────────────────
function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
function setSession(d) { localStorage.setItem(SESSION_KEY, JSON.stringify(d)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' toast-' + type : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3500);
}

function showPage(id) {
  const displayMap = { 'login-page': 'flex', 'dashboard': 'flex', 'setup-page': 'block' };
  ['login-page','dashboard','setup-page'].forEach(p => {
    const el = document.getElementById(p);
    if (!el) return;
    el.style.display = (p === id) ? (displayMap[p] || 'block') : 'none';
  });
}

// ── LOGIN ─────────────────────────────────────────────────
async function doLogin() {
  const username = document.getElementById('t-user').value.trim().toLowerCase();
  const password = document.getElementById('t-pass').value.trim();
  const errEl    = document.getElementById('t-err');
  const btn      = document.getElementById('t-login-btn');
  errEl.style.display = 'none';
  if (!username || !password) { errEl.textContent='Username dan password wajib diisi.'; errEl.style.display='block'; return; }
  btn.disabled = true; btn.textContent = 'Memuat...';
  try {
    const snap = await getDoc(doc(db, 'talents', username));
    if (!snap.exists()) throw new Error('Username atau password salah.');
    const data = snap.data();
    if (data.password !== password) throw new Error('Username atau password salah.');
    _docId = username;
    currentTalent = { id: username, ...data };
    setSession({ docId: username });
    loadDashboard();
  } catch(e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'Masuk';
}

// ── DASHBOARD ─────────────────────────────────────────────
function loadDashboard() {
  document.getElementById('t-avatar').textContent   = (currentTalent.name || _docId)[0].toUpperCase();
  document.getElementById('t-name-top').textContent = currentTalent.name || _docId;
  if (currentTalent.status === 'draft' || currentTalent.status === 'rejected') {
    renderSetupPage(); showPage('setup-page'); return;
  }
  showPage('dashboard');
  listenStatus();
  updateBanner();
  renderSettingsPanel();
}

function updateBanner() {
  const b = document.getElementById('status-banner');
  if (!b) return;
  if (currentTalent.status === 'pending') {
    b.innerHTML = `<div style="background:rgba(255,184,0,.08);border:1px solid rgba(255,184,0,.2);border-radius:12px;padding:14px 18px;margin-bottom:20px;font-size:.85rem;font-weight:700;color:var(--yellow)">⏳ Profil kamu sedang dalam review admin. Harap tunggu persetujuan.</div>`;
  } else if (currentTalent.status === 'rejected') {
    b.innerHTML = `<div style="background:rgba(255,92,92,.06);border:1px solid rgba(255,92,92,.2);border-radius:12px;padding:14px 18px;margin-bottom:20px">
      <p style="font-size:.85rem;font-weight:800;color:var(--red);margin-bottom:6px">❌ Perubahan profil ditolak admin</p>
      ${currentTalent.declineReason?`<p style="font-size:.82rem;color:var(--muted);font-weight:600">Alasan: "${currentTalent.declineReason}"</p>`:''}
      <button onclick="document.getElementById('tab-settings').click()" style="margin-top:10px;padding:7px 18px;border-radius:99px;background:var(--pink-mid);color:#fff;border:none;font-size:.8rem;font-weight:800;cursor:pointer">Edit & Kirim Ulang</button>
    </div>`;
  } else { b.innerHTML = ''; }
}

// ── POINT DISPLAY ─────────────────────────────────────────
function updatePointDisplay(points) {
  const el = document.getElementById('talent-point-box');
  if (!el) return;
  const pct = Math.min(100, Math.round((points / POINT_MAX) * 100));
  el.innerHTML = `
    <div onclick="openPointModal()" style="background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.25);border-radius:14px;padding:16px 18px;margin-bottom:16px;cursor:pointer;transition:border-color .2s" onmouseover="this.style.borderColor='rgba(167,139,250,.5)'" onmouseout="this.style.borderColor='rgba(167,139,250,.25)'">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:1.8rem">⭐</div>
          <div>
            <div style="font-size:.7rem;font-weight:800;color:#a78bfa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:1px">Total Point Kamu</div>
            <div style="font-size:1.6rem;font-weight:900;color:#a78bfa;line-height:1">${points} <span style="font-size:.85rem">/ ${POINT_MAX}</span></div>
          </div>
        </div>
        <div style="font-size:.72rem;color:rgba(167,139,250,.6);font-weight:700">Tap untuk riwayat →</div>
      </div>
      <div style="height:6px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#7c3aed,#a78bfa);border-radius:99px;transition:width .5s ease"></div>
      </div>
    </div>`;
}

// ── POINT MODAL (history) ─────────────────────────────────
window.openPointModal = async function() {
  const modal = document.getElementById('point-modal');
  modal.style.display = 'flex';
  const listEl = document.getElementById('point-history-list');
  listEl.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(240,235,248,.45)">Memuat riwayat...</div>';
  try {
    const q    = query(collection(db, 'talents', _docId, 'point_history'), orderBy('createdAt', 'desc'), limit(30));
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(240,235,248,.45)"><div style="font-size:2rem;margin-bottom:8px">📭</div><p style="font-size:.85rem">Belum ada riwayat point</p></div>';
      return;
    }
    listEl.innerHTML = snap.docs.map(d => {
      const h     = d.data();
      const delta = h.delta || 0;
      const isPos = delta >= 0;
      const color = isPos ? '#3DD68C' : '#FF5C5C';
      const sign  = isPos ? '+' : '';
      const date  = h.createdAt?.toDate ? h.createdAt.toDate().toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '-';
      return `
      <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)">
        <div style="width:36px;height:36px;border-radius:50%;background:${isPos?'rgba(61,214,140,.1)':'rgba(255,92,92,.1)'};border:1px solid ${isPos?'rgba(61,214,140,.25)':'rgba(255,92,92,.25)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:.9rem">${isPos?'⬆️':'⬇️'}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div style="font-size:.85rem;font-weight:700;color:var(--text)">${h.reason || 'Tidak ada keterangan'}</div>
            <div style="font-size:1rem;font-weight:900;color:${color};white-space:nowrap">${sign}${delta}</div>
          </div>
          <div style="font-size:.72rem;color:rgba(240,235,248,.4);margin-top:3px;font-weight:600">${date} · Dari: ${h.total ?? '-'} point</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    listEl.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,92,92,.7)">Gagal memuat riwayat.</div>';
  }
};

window.closePointModal = function() {
  document.getElementById('point-modal').style.display = 'none';
};

// ── POINT SYSTEM OTOMATIS ─────────────────────────────────





// ── STATUS ────────────────────────────────────────────────
function listenStatus() {
  onSnapshot(doc(db, 'talents', _docId), snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    currentTalent = { ...currentTalent, ...data };
    const online = data.online !== false;
    updateStatusUI(online);
    updateBanner();
    updatePointDisplay(data.points !== undefined ? data.points : 100);
    document.getElementById('t-avatar').textContent   = (data.name || _docId)[0].toUpperCase();
    document.getElementById('t-name-top').textContent = data.name || _docId;
  });
}

function updateStatusUI(online) {
  const dot=document.getElementById('status-dot'), text=document.getElementById('status-text'), toggle=document.getElementById('status-toggle');
  if (!dot||!text||!toggle) return;
  dot.className    = 'status-dot '+(online?'online':'offline');
  text.textContent = online ? 'Kamu sedang ONLINE' : 'Kamu sedang OFFLINE';
  toggle.textContent = online ? 'Set Offline' : 'Set Online';
  toggle.className   = 'status-toggle'+(online?' active':'');
}

async function toggleStatus() {
  if (!_docId) return;
  const snap = await getDoc(doc(db, 'talents', _docId));
  const on   = snap.exists() ? snap.data().online !== false : false;
  await setDoc(doc(db, 'talents', _docId), { online: !on }, { merge: true });
  toast(on ? '⚫ Kamu OFFLINE' : '🟢 Kamu ONLINE');
}

// ── SETUP PAGE ────────────────────────────────────────────
window._showSetup = function() { renderSetupPage(); showPage('setup-page'); };

function renderSetupPage() {
  const t  = currentTalent;
  const el = document.getElementById('setup-content');
  if (!el) return;
  _uploadedAudioUrl = '';
  _uploadedPhotoUrl = '';
  el.innerHTML = buildProfileForm(t, false);
  attachFormHandlers();
}

function renderSettingsPanel() {
  const t  = currentTalent;
  const el = document.getElementById('settings-content');
  if (!el) return;
  _uploadedAudioUrl = '';
  _uploadedPhotoUrl = '';
  const hasPendingEdit = currentTalent._pendingEdit === true;
  el.innerHTML = `
    ${hasPendingEdit ? `
    <div style="background:rgba(255,184,0,.08);border:1px solid rgba(255,184,0,.2);border-radius:12px;padding:14px 18px;margin-bottom:20px;font-size:.84rem;font-weight:700;color:var(--yellow)">
      ⏳ Ada perubahan profil yang sedang menunggu persetujuan admin.
    </div>` : ''}
    ${buildProfileForm(t, true)}
  `;
  attachFormHandlers();
}

function buildProfileForm(t, isSettingMode) {
  const title   = isSettingMode ? '✏️ Edit Profil' : (t.status==='rejected' ? '✏️ Edit & Kirim Ulang' : '📝 Setup Profil');
  const btnText = '💾 Simpan Profil';
  return `
  <div class="setup-card">
    <h2 style="font-size:1.2rem;font-weight:900;margin-bottom:20px">${title}</h2>
    ${!isSettingMode && t.status==='rejected' && t.declineReason ? `<div style="background:rgba(255,92,92,.06);border:1px solid rgba(255,92,92,.2);border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:.82rem;color:var(--red);font-weight:700">❌ "${t.declineReason}"</div>` : ''}
    <div class="setup-section">
      <div class="setup-label">📷 Foto Profil ${t.img ? "(sudah ada, opsional ganti)" : "*"}</div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div id="photo-preview" style="width:76px;height:76px;border-radius:12px;overflow:hidden;background:var(--surface2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:2rem">
          ${t.img ? `<img src="${t.img}" style="width:100%;height:100%;object-fit:cover">` : '👤'}
        </div>
        <label class="upload-audio-label">
          <input type="file" id="photo-file" accept="image/*" style="display:none" onchange="previewPhoto(this)">
          <span id="photo-lbl">📁 Pilih Foto</span>
        </label>
      </div>
      <div id="photo-prog" style="display:none;margin-top:8px">
        <div style="height:5px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden"><div id="photo-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#E8628A,#F9A8C9);border-radius:99px;transition:width .3s"></div></div>
        <p id="photo-prog-txt" style="font-size:.73rem;color:var(--muted);margin-top:4px"></p>
      </div>
    </div>
    <div class="setup-section">
      <div class="setup-label">📛 Nama Tampil *</div>
      <input type="text" id="s-name" class="setup-input" value="${t.name||''}" placeholder="Nama kamu">
    </div>
    <div class="setup-section">
      <div class="setup-label">🎂 Umur *</div>
      <input type="number" id="s-age" class="setup-input" value="${t.age||''}" placeholder="Umur" min="18" max="35">
    </div>
    <div class="setup-section">
      <div class="setup-label">💬 Bio Singkat</div>
      <textarea id="s-bio" class="setup-input" rows="3" placeholder="Ceritakan tentang dirimu...">${t.bio||''}</textarea>
    </div>
    <div class="setup-section">
      <div class="setup-label">📱 Nomor WhatsApp *</div>
      <input type="tel" id="s-wa" class="setup-input" value="${t.waNumber||''}" placeholder="Contoh: 8123456789 (tanpa 0)">
      <div style="font-size:.72rem;color:var(--muted);font-weight:600;margin-top:4px">Digunakan untuk menerima notifikasi order masuk</div>
    </div>
    <div class="setup-section">
      <div class="setup-label">🎯 Layanan *</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px" id="svc-wrap">
        ${ALL_SERVICES.map(s=>{
          const isLocked = (t.lockedServices||[]).includes(s);
          const isChecked = (t.services||[]).includes(s) && !isLocked;
          return `
        <label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px" onclick="${isLocked ? `showLockedPopup('${s}');return false;` : ''}">
          <input type="checkbox" value="${s}" class="svc-ck" ${isChecked?'checked':''} ${isLocked?'disabled':''} style="display:none">
          <span class="svc-pill ${isChecked?'svc-active':''} ${isLocked?'svc-locked':''}">${s} ${isLocked?'🔒':''}</span>
        </label>`;}).join('')}
      </div>
    </div>

    <p id="s-err" style="color:var(--red);font-size:.82rem;font-weight:700;display:none;margin-bottom:8px"></p>
    <button id="s-submit" onclick="submitProfile()" style="width:100%;padding:13px;border-radius:99px;background:var(--pink-mid);color:white;border:none;font-weight:800;font-size:.9rem;cursor:pointer;transition:opacity .2s;box-shadow:0 0 18px var(--pink-glow)">
      ${btnText}
    </button>

    ${!isSettingMode && (t.status==='approved'||t.status==='pending') ? `<button onclick="showPage('dashboard')" style="width:100%;margin-top:10px;padding:11px;border-radius:99px;background:transparent;border:1.5px solid var(--border);color:var(--muted);font-weight:800;font-size:.85rem;cursor:pointer">← Kembali</button>` : ''}
  </div>`;
}

window.showLockedPopup = function(svc) {
  // Popup layanan terkunci
  let popup = document.getElementById('locked-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'locked-popup';
    popup.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px';
    popup.innerHTML = `
      <div style="background:linear-gradient(145deg,#16162A,#1E1E35);border:1px solid rgba(255,92,92,.3);border-radius:20px;padding:28px;max-width:340px;width:100%;text-align:center">
        <div style="font-size:2.5rem;margin-bottom:12px">🔒</div>
        <div style="font-size:1rem;font-weight:900;margin-bottom:8px" id="locked-popup-title">Layanan Terkunci</div>
        <div style="font-size:.85rem;color:rgba(240,235,248,.6);font-weight:600;line-height:1.6;margin-bottom:20px">
          Layanan <strong id="locked-popup-svc" style="color:#ff7b7b"></strong> sedang dikunci oleh owner.<br>Hubungi owner untuk membuka akses layanan ini.
        </div>
        <button onclick="document.getElementById('locked-popup').remove()" style="width:100%;padding:12px;border-radius:99px;background:var(--pink-mid,#E8628A);border:none;color:#fff;font-weight:800;font-size:.9rem;cursor:pointer">Mengerti</button>
      </div>`;
    popup.addEventListener('click', e => { if(e.target===popup) popup.remove(); });
    document.body.appendChild(popup);
  }
  document.getElementById('locked-popup-svc').textContent = svc;
  popup.style.display = 'flex';
};

function attachFormHandlers() {
  document.querySelectorAll('.svc-ck').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.nextElementSibling.classList.toggle('svc-active', cb.checked);
    });
  });
}

window.previewPhoto = function(input) {
  const file = input.files[0]; if (!file) return;
  document.getElementById('photo-lbl').textContent = '⏳ Mengupload...';
  document.getElementById('photo-prog').style.display = 'block';
  const bar = document.getElementById('photo-bar');
  const txt = document.getElementById('photo-prog-txt');
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('photo-preview').innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;
  };
  reader.readAsDataURL(file);
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_PRESET);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`);
  xhr.upload.onprogress = e => { if (e.lengthComputable) { const p=Math.round(e.loaded/e.total*100); bar.style.width=p+'%'; txt.textContent=`${p}%`; } };
  xhr.onload = () => {
    if (xhr.status === 200) {
      const res = JSON.parse(xhr.responseText);
      _uploadedPhotoUrl = res.secure_url;
      txt.textContent = '✅ Foto berhasil diupload!'; bar.style.background='var(--green)';
      document.getElementById('photo-lbl').textContent = '✅ ' + file.name;
      setTimeout(()=>{ document.getElementById('photo-prog').style.display='none'; bar.style.width='0%'; bar.style.background='linear-gradient(90deg,#E8628A,#F9A8C9)'; }, 2500);
    } else { txt.textContent='❌ Gagal upload foto.'; }
  };
  xhr.onerror = ()=>{ txt.textContent='❌ Gagal.'; };
  xhr.send(fd);
};

window.handleAudio = function(input) {
  const file = input.files[0]; if (!file) return;
  if (file.size > 10*1024*1024) { alert('Maks 10MB!'); return; }
  document.getElementById('audio-lbl').textContent = '⏳ Mengupload...';
  document.getElementById('audio-prog').style.display = 'block';
  const bar = document.getElementById('audio-bar');
  const txt = document.getElementById('audio-prog-txt');
  const fd  = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_PRESET);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`);
  xhr.upload.onprogress = e => { if (e.lengthComputable) { const p=Math.round(e.loaded/e.total*100); bar.style.width=p+'%'; txt.textContent=`${p}%`; } };
  xhr.onload = () => {
    if (xhr.status===200) {
      const res = JSON.parse(xhr.responseText);
      _uploadedAudioUrl = res.secure_url;
      txt.textContent = '✅ Berhasil!'; bar.style.background='var(--green)';
      document.getElementById('audio-lbl').textContent = '✅ ' + file.name;
      const el = document.getElementById('audio-new-el');
      if (el) { el.src=_uploadedAudioUrl; document.getElementById('audio-new').style.display='block'; }
      setTimeout(()=>{ document.getElementById('audio-prog').style.display='none'; bar.style.width='0%'; bar.style.background='linear-gradient(90deg,#E8628A,#F9A8C9)'; }, 2500);
    } else { txt.textContent='❌ Gagal.'; }
  };
  xhr.onerror = ()=>{ txt.textContent='❌ Gagal.'; };
  xhr.send(fd);
};

window.submitProfile = async function() {
  const name      = document.getElementById('s-name')?.value.trim();
  const age       = parseInt(document.getElementById('s-age')?.value);
  const bio       = document.getElementById('s-bio')?.value.trim();
  const waNumber  = document.getElementById('s-wa')?.value.trim().replace(/^0/, '') || '';
  const services  = [...document.querySelectorAll('.svc-ck:checked')].map(c=>c.value);
  const errEl     = document.getElementById('s-err');
  const btn       = document.getElementById('s-submit');
  errEl.style.display = 'none';
  // Pakai data lama kalau tidak diubah
  const finalName = name || currentTalent.name || '';
  const finalAge  = (!isNaN(age) && age >= 18 && age <= 35) ? age : currentTalent.age;
  if (!finalName)            { errEl.textContent='Nama wajib diisi.'; errEl.style.display='block'; return; }
  if (!finalAge||finalAge<18||finalAge>35) { errEl.textContent='Umur harus 18–35 tahun.'; errEl.style.display='block'; return; }
  if (!services.length)      { errEl.textContent='Pilih minimal 1 layanan.'; errEl.style.display='block'; return; }
  // Foto wajib ada (bisa dari upload baru atau data lama)
  if (!_uploadedPhotoUrl && !currentTalent.img) { errEl.textContent='Upload foto profil terlebih dahulu.'; errEl.style.display='block'; return; }
  // Audio tidak wajib kalau sudah ada, tapi kalau belum pernah ada memang wajib
  // (dibiarkan opsional — talent bisa simpan tanpa ganti audio)
  btn.disabled=true; btn.textContent='Mengirim...';
  try {
    const finalImg   = _uploadedPhotoUrl   || currentTalent.img   || '';
    const finalAudio = _uploadedAudioUrl   || currentTalent.audio || '';
    // Simpan langsung ke Firestore tanpa review admin
    await setDoc(doc(db, 'talents', _docId), {
      name    : finalName,
      age     : finalAge,
      bio,
      services,
      img     : finalImg,
      audio   : finalAudio,
      waNumber,
      _pendingEdit: false,
    }, { merge: true });
    currentTalent = { ...currentTalent, name:finalName, age:finalAge, bio, services, img:finalImg, audio:finalAudio };
    toast('✅ Profil berhasil disimpan!');
    _uploadedAudioUrl = ''; _uploadedPhotoUrl = '';
    renderSettingsPanel();
    updateBanner();
  } catch(e) {
    errEl.textContent='Gagal: '+e.message; errEl.style.display='block';
  }
  btn.disabled=false;
  btn.textContent = currentTalent.status === 'approved' ? '📤 Simpan & Minta Persetujuan' : (currentTalent.status==='rejected' ? '📤 Kirim Ulang' : '📤 Submit untuk Review');
};

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await DB.getSettingsAsync();
  loadServicesForTalent();
  const session = getSession();
  if (session?.docId) {
    try {
      const snap = await getDoc(doc(db, 'talents', session.docId));
      if (snap.exists()) {
        _docId = session.docId;
        currentTalent = { id: session.docId, ...snap.data() };
        loadDashboard();
      } else clearSession();
    } catch { clearSession(); }
  }
  document.getElementById('t-login-btn').onclick = doLogin;
  document.getElementById('t-user').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  document.getElementById('t-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  document.getElementById('t-logout-btn').onclick = () => {
    clearSession(); currentTalent=null; _docId=null;
    const userEl = document.getElementById('t-user');
    const passEl = document.getElementById('t-pass');
    const errEl  = document.getElementById('t-err');
    if (userEl) userEl.value = '';
    if (passEl) passEl.value = '';
    if (errEl)  { errEl.textContent = ''; errEl.style.display = 'none'; }
    showPage('login-page');
  };
  document.getElementById('status-toggle').onclick = toggleStatus;
  document.getElementById('tab-settings').onclick  = () => renderSettingsPanel();
  // Tutup modal point kalau klik backdrop
  document.getElementById('point-modal').addEventListener('click', function(e) {
    if (e.target === this) closePointModal();
  });
});
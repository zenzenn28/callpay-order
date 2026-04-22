# CallPay Order System

Sistem order talent dengan timer 2 menit, voucher, dan notif Twilio WA.

## Cara Deploy ke Vercel

### 1. Install Vercel CLI
```bash
npm i -g vercel
```

### 2. Login Vercel
```bash
vercel login
```

### 3. Deploy
```bash
cd callpay-order
vercel --prod
```

### 4. Setelah deploy, catat URL Vercel kamu
Contoh: `https://callpay-order.vercel.app`

### 5. Update URL di order-patch.js
Ganti baris:
```js
const API_BASE = 'https://YOUR-VERCEL-URL.vercel.app';
```
Dengan URL Vercel kamu yang sebenarnya.

### 6. Pasang order-patch.js di callpay.id
Tambahkan di `index.html` sebelum tag `</body>`:
```html
<script src="https://callpay-order.vercel.app/order-patch.js"></script>
```

## Setup Twilio WhatsApp Sandbox
1. Buka console.twilio.com → Messaging → Try WhatsApp
2. Kirim pesan "join <kata-sandi>" ke +14155238886
3. Talent harus join sandbox dulu sebelum bisa dapat notif

## Struktur File
```
callpay-order/
├── api/
│   ├── order.js          - Buat order baru
│   ├── order-status.js   - Cek status order
│   ├── respond-order.js  - Talent terima/tolak
│   ├── expire-orders.js  - Auto expire timer habis
│   ├── check-voucher.js  - Validasi voucher
│   └── get-voucher.js    - Ambil voucher dari order
├── public/
│   ├── waiting.html      - Halaman tunggu cust
│   └── order-patch.js    - Patch modal order di website utama
├── lib/
│   └── firebase.js       - Firebase REST helper
├── vercel.json
└── package.json
```

## Environment Variables di Vercel
Set di Vercel Dashboard → Settings → Environment Variables:
- MIDTRANS_SERVER_KEY
- MIDTRANS_CLIENT_KEY
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_WA_NUMBER
- FIREBASE_PROJECT_ID
- FIREBASE_API_KEY

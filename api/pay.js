// api/pay.js — membuat order + Snap token Midtrans.
// Pembeli HARUS login (Firebase ID token). uid & email diambil dari token,
// bukan dari body, sehingga pembayaran selalu terhubung ke akun yang benar.
import midtransClient from 'midtrans-client';
import { randomBytes } from 'node:crypto';
import { db, applyCors, requireUser } from './_firebase.js';

// ── Harga & durasi resmi (server adalah sumber kebenaran) ────────
const PLANS = {
  'pro-monthly': { price: 19000,  label: 'Kasva Pro Bulanan', months: 1  },
  'pro-yearly':  { price: 199000, label: 'Kasva Pro Tahunan', months: 12 },
};

export default async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).end();

  // ── Autentikasi ──────────────────────────────────────────────
  let user;
  try { user = await requireUser(req); }
  catch { return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' }); }

  if (!user.email_verified) {
    return res.status(403).json({ error: 'Verifikasi email Anda terlebih dahulu.' });
  }

  const { plan, billing, price, name, phone } = req.body || {};

  // ── Validasi input ───────────────────────────────────────────
  if (!plan || !billing || !name || !phone) {
    return res.status(400).json({ error: 'Field tidak lengkap.' });
  }
  const planKey  = `${plan}-${billing}`;
  const planData = PLANS[planKey];
  if (!planData) return res.status(400).json({ error: 'Paket tidak valid.' });

  if (price && parseInt(price, 10) !== planData.price) {
    return res.status(400).json({ error: 'Harga tidak sesuai.' });
  }

  const cleanName  = String(name).trim().slice(0, 80);
  const cleanPhone = String(phone).replace(/[^\d+]/g, '');
  if (!cleanName) return res.status(400).json({ error: 'Nama wajib diisi.' });
  if (cleanPhone.length < 8 || cleanPhone.length > 16) {
    return res.status(400).json({ error: 'No. HP tidak valid.' });
  }

  // ── Order ID unik (≤ 50 karakter sesuai batas Midtrans) ──────
  const orderId = `KASVA-${plan.toUpperCase()}-${billing.toUpperCase()}-${Date.now()}-${randomBytes(2).toString('hex')}`;

  try {
    // Order pending disimpan di koleksi `orders` — TIDAK menyentuh
    // users/{uid}/subscription/data (itu hanya diubah webhook setelah settlement).
    await db.collection('orders').doc(orderId).set({
      orderId,
      uid:     user.uid,
      plan,
      billing,
      price:   planData.price,
      months:  planData.months,
      name:    cleanName,
      email:   user.email,
      phone:   cleanPhone,
      status:  'pending',
      applied: false,
      createdAt: new Date().toISOString(),
    });

    const snap = new midtransClient.Snap({
      isProduction: true,
      serverKey:    process.env.MIDTRANS_SERVER_KEY,
      clientKey:    process.env.MIDTRANS_CLIENT_KEY,
    });

    const transaction = await snap.createTransaction({
      transaction_details: { order_id: orderId, gross_amount: planData.price },
      item_details: [{ id: planKey, price: planData.price, quantity: 1, name: planData.label }],
      customer_details: { first_name: cleanName, email: user.email, phone: cleanPhone },
      callbacks: { finish: `https://kasva.store/subscribe?order_id=${orderId}` },
    });

    return res.status(200).json({ token: transaction.token, order_id: orderId });
  } catch (err) {
    console.error('[PAY ERROR]', err);
    return res.status(500).json({ error: 'Gagal membuat pembayaran. Coba lagi.' });
  }
}

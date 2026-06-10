// api/pay.js
import midtransClient from 'midtrans-client';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();

// ── Harga & durasi resmi ─────────────────────────────────────────
const PLANS = {
  'starter-monthly': { price: 49000,  label: 'Kasva Starter Bulanan',   months: 1  },
  'pro-monthly':     { price: 99000,  label: 'Kasva Pro Bulanan',        months: 1  },
  'pro-yearly':      { price: 599000, label: 'Kasva Pro Tahunan',        months: 12 },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  const { uid, plan, billing, price, name, email, phone } = req.body;

  // ── Validasi input ───────────────────────────────────────────
  if (!plan || !billing || !name || !email || !phone) {
    return res.status(400).json({ error: 'Field tidak lengkap.' });
  }

  const planKey = `${plan}-${billing}`;
  const planData = PLANS[planKey];
  if (!planData) {
    return res.status(400).json({ error: `Paket tidak valid: ${planKey}` });
  }

  // Validasi harga (anti-tamper dari frontend)
  if (price && parseInt(price) !== planData.price) {
    return res.status(400).json({ error: 'Harga tidak sesuai.' });
  }

  // ── Generate order ID unik ───────────────────────────────────
  const orderId = `KASVA-${plan.toUpperCase()}-${billing.toUpperCase()}-${Date.now()}`;

  try {
    // ── Simpan pending order ke Firestore ────────────────────────
    // Menyimpan uid agar notification.js tahu siapa yang harus diupdate
    await db.collection('orders').doc(orderId).set({
      orderId,
      uid:     uid || null,
      plan,
      billing,
      price:   planData.price,
      months:  planData.months,
      name,
      email,
      phone,
      status:  'pending',
      createdAt: new Date().toISOString(),
    });

    // ── Generate Snap token ──────────────────────────────────────
    const snap = new midtransClient.Snap({
      isProduction: true,
      serverKey:    process.env.MIDTRANS_SERVER_KEY,
      clientKey:    process.env.MIDTRANS_CLIENT_KEY,
    });

    const parameter = {
      transaction_details: {
        order_id:     orderId,
        gross_amount: planData.price,
      },
      item_details: [{
        id:       planKey,
        price:    planData.price,
        quantity: 1,
        name:     planData.label,
      }],
      customer_details: {
        first_name: name,
        email,
        phone,
      },
      callbacks: {
        finish: `https://kasva.store/subscribe?order_id=${orderId}`,
      },
    };

    const transaction = await snap.createTransaction(parameter);

    return res.status(200).json({
      token:    transaction.token,
      order_id: orderId,
    });

  } catch (err) {
    console.error('[PAY ERROR]', err);
    return res.status(500).json({ error: err.message });
  }
}
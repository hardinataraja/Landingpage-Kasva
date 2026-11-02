// api/check-payment.js
// Mengembalikan HANYA status pembayaran. (Versi lama mengembalikan seluruh
// dokumen order — termasuk nama, email, HP, dan uid — ke siapa pun yang
// mengetahui order_id.)
import { db, applyCors } from './_firebase.js';

export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).end();

  const orderId = String(req.query.order_id || '');
  if (!/^KASVA-[A-Z0-9-]{5,60}$/.test(orderId)) {
    return res.status(400).json({ error: 'order_id tidak valid' });
  }

  try {
    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) return res.status(404).json({ status: 'not_found' });
    const d = doc.data();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      status: d.status || 'pending',                 // pending | success | failed
      transaction_status: d.transaction_status || null,
      applied: d.applied === true,                    // langganan sudah diaktifkan
    });
  } catch (err) {
    console.error('[CHECK ERROR]', err);
    return res.status(500).json({ error: 'Gagal memeriksa status.' });
  }
}

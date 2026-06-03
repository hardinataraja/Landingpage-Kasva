// api/pay.js
// Endpoint ini sekarang tidak digunakan untuk generate Snap token.
// Flow pembayaran menggunakan Midtrans Payment Link langsung.
// File ini tetap dipertahankan sebagai fallback / future use.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(200).json({ 
    message: 'Payment via Midtrans Payment Link. No token needed.',
    payment_link: 'https://app.midtrans.com/payment-links/39834f21-2c82-4660-bee2-463163554b0e'
  });
}

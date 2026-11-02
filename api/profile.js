// api/profile.js
// Dipanggil setelah pendaftaran lewat website. Membuat dokumen users/{uid}
// dengan skema yang SAMA seperti pendaftaran di aplikasi (register_screen.dart),
// supaya login pertama di aplikasi tidak menemui dokumen kosong.
// Aman dipanggil berulang: tidak menimpa dokumen yang sudah ada.
import { FieldValue } from 'firebase-admin/firestore';
import { db, applyCors, requireUser } from './_firebase.js';

export default async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).end();

  let user;
  try { user = await requireUser(req); }
  catch (e) { return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' }); }

  const rawName = String((req.body && req.body.name) || '').trim().slice(0, 80);
  const name  = rawName || String(user.name || '').trim().slice(0, 80) || 'Pengguna';
  const email = user.email || '';

  try {
    await db.collection('users').doc(user.uid).create({
      uid: user.uid,
      name,
      email,
      createdAt: FieldValue.serverTimestamp(),
      plan: 'free',
      productCount: 0,
      txThisMonth: 0,
      lastTxMonth: new Date().getMonth() + 1,
      trialUsed: false,
      referredBy: '',
      referralCode: '',
      referralBalance: 0,
      referralBalanceHold: 0,
      settings: {
        storeName: 'Toko Saya',
        address: '',
        phone: '',
        iconName: 'store',
        receiptFooter: 'Terima kasih atas kunjungan Anda!',
        taxRate: 0,
        currency: 'Rp',
        cashierName: name,
        printAutomatically: false,
      },
    });
    return res.status(200).json({ created: true });
  } catch (err) {
    // 6 = ALREADY_EXISTS → dokumen sudah ada (mis. dibuat dari aplikasi): normal.
    if (err && (err.code === 6 || /ALREADY_EXISTS/.test(String(err.message)))) {
      return res.status(200).json({ created: false });
    }
    console.error('[PROFILE ERROR]', err);
    return res.status(500).json({ error: 'Gagal menyiapkan profil.' });
  }
}

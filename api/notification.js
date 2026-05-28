// api/notification.js
import midtransClient from 'midtrans-client';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Init Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const apiClient = new midtransClient.CoreApi({
      isProduction: true,
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
    });

    // 1. Terima dan verifikasi notifikasi dari Midtrans
    const statusResponse = await apiClient.transaction.notification(req.body);
    const { order_id, transaction_status, fraud_status, gross_amount } = statusResponse;

    console.log(`[MIDTRANS NOTIF] Order: ${order_id} | Status: ${transaction_status} | Fraud: ${fraud_status}`);

    // 2. Tentukan status aplikasi berdasarkan status Midtrans
    // Logika ini memastikan settlement/capture dianggap success
    let status = 'pending';
    if (transaction_status === 'settlement' || transaction_status === 'capture') {
      status = 'success';
    } else if (['cancel', 'deny', 'expire'].includes(transaction_status)) {
      status = 'failed';
    } else {
      status = 'pending'; // Pastikan status selain di atas tetap pending
    }

    // 3. Update ke Firestore
    // Kita gunakan merge: true agar data lain (jika ada) tidak hilang
    await db.collection('payments').doc(order_id).set({
      order_id,
      status, 
      transaction_status,
      fraud_status: fraud_status || null,
      gross_amount: Number(gross_amount),
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    console.log(`[FIRESTORE UPDATE] Order ${order_id} berhasil diupdate ke status: ${status}`);

    // 4. Berikan respon 200 agar Midtrans berhenti mengirim notifikasi
    return res.status(200).json({ status: 'OK', order_id, status });
    
  } catch (error) {
    console.error('[WEBHOOK ERROR]', error);
    return res.status(500).json({ error: error.message });
  }
}

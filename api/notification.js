// api/notification.js
import midtransClient from 'midtrans-client';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Init Firebase Admin (hanya sekali)
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

    // Mengambil notifikasi dari Midtrans
    const statusResponse = await apiClient.transaction.notification(req.body);
    const { order_id, transaction_status, fraud_status, gross_amount } = statusResponse;

    console.log(`Notifikasi diterima: Order ${order_id} - Status: ${transaction_status}`);

    // Menentukan status untuk aplikasi
    let status = 'pending';
    if (transaction_status === 'capture' || transaction_status === 'settlement') {
      status = 'success';
    } else if (['cancel', 'expire', 'deny'].includes(transaction_status)) {
      status = 'failed';
    }

    // Update status ke Firestore
    // Menggunakan doc(order_id) agar sinkron dengan check-payment.js
    await db.collection('payments').doc(order_id).set({
      order_id,
      status, // 'success', 'failed', atau 'pending'
      transaction_status, // Status asli dari Midtrans untuk referensi
      fraud_status: fraud_status || null,
      gross_amount: Number(gross_amount) || 35000,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    console.log(`Firestore berhasil diupdate: Order ${order_id} menjadi status ${status}`);

    return res.status(200).json({ status: 'OK' });
  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

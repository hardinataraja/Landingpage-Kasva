// api/notification.js
import midtransClient from 'midtrans-client';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const apiClient = new midtransClient.CoreApi({
      isProduction: true,
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
    });

    const statusResponse = await apiClient.transaction.notification(req.body);
    
    const { order_id, transaction_status, fraud_status } = statusResponse;

    console.log(`Notif: ${order_id} - ${transaction_status} - ${fraud_status}`);

    // Logika status
    if (transaction_status === 'capture' || transaction_status === 'settlement') {
      // ✅ PEMBAYARAN SUKSES
      // Simpan ke Firestore / database kamu di sini
      console.log(`Order ${order_id} SUKSES`);
    } else if (transaction_status === 'pending') {
      console.log(`Order ${order_id} PENDING`);
    } else {
      // cancel, expire, deny
      console.log(`Order ${order_id} GAGAL: ${transaction_status}`);
    }

    return res.status(200).json({ status: 'OK' });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}

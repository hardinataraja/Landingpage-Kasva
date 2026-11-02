// api/notification.js
// Webhook Midtrans → memperbarui users/{uid}/subscription/data
//
// Keamanan & ketepatan:
//  • Notifikasi diverifikasi lewat API Midtrans (CoreApi.transaction.notification
//    + GET status via transaction_id); isi body mentah tidak dipercaya.
//  • Hanya settlement / capture(accept) yang mengaktifkan langganan.
//  • gross_amount dicocokkan dengan harga yang tersimpan di order.
//  • IDEMPOTEN: order yang sudah `applied` tidak memperpanjang dua kali
//    (Midtrans bisa mengirim notifikasi settlement berulang).
//  • Status sukses tidak ditimpa oleh notifikasi pending/expire yang datang terlambat.
//  • Semua penulisan order+subscription dalam satu transaksi Firestore.
import midtransClient from 'midtrans-client';
import { db } from './_firebase.js';
import { computeSubscription } from './_subscription.js';

// Catat notifikasi bermasalah ke Firestore agar bisa ditinjau kapan saja.
async function logFailedNotification(reason, notif, orderData = null) {
  try {
    await db.collection('failed_notifications').add({
      reason,
      orderIdFromWebhook: notif.order_id ?? null,
      transactionId:      notif.transaction_id ?? null,
      paymentType:        notif.payment_type ?? null,
      transactionStatus:  notif.transaction_status ?? null,
      fraudStatus:        notif.fraud_status ?? null,
      grossAmount:        notif.gross_amount ? Number(notif.gross_amount) : null,
      orderDataFound:     orderData,
      resolved:           false,
      createdAt:          new Date().toISOString(),
    });
  } catch (logErr) {
    console.error('[NOTIF] Gagal simpan failed_notifications:', logErr.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // ── 1. Verifikasi ke Midtrans ────────────────────────────
    const apiClient = new midtransClient.CoreApi({
      isProduction: true,
      serverKey:    process.env.MIDTRANS_SERVER_KEY,
      clientKey:    process.env.MIDTRANS_CLIENT_KEY,
    });

    const rawNotif = await apiClient.transaction.notification(req.body);

    // Untuk beberapa channel (DANA, BSI/SeaBank/Danamon VA) order_id di body webhook
    // tidak bisa diandalkan → selalu ambil status resmi via transaction_id.
    let notif = rawNotif;
    try {
      const statusResp = await apiClient.transaction.status(rawNotif.transaction_id);
      notif = { ...rawNotif, ...statusResp };
    } catch (statusErr) {
      console.error(`[NOTIF] Gagal fetch status transaction_id=${rawNotif.transaction_id}:`, statusErr.message);
    }

    const { order_id, transaction_status, fraud_status, gross_amount } = notif;
    console.log(`[NOTIF] ${order_id} | ${transaction_status} | fraud: ${fraud_status} | ${notif.payment_type}`);

    // ── 2. Tentukan status ───────────────────────────────────
    const isSuccess =
      transaction_status === 'settlement' ||
      (transaction_status === 'capture' && fraud_status === 'accept');
    const isFailed = ['cancel', 'deny', 'expire', 'failure'].includes(transaction_status);
    const status   = isSuccess ? 'success' : isFailed ? 'failed' : 'pending';

    // ── 3. Order harus ada (jangan membuat order "hantu") ─────
    const orderRef = db.collection('orders').doc(order_id);
    const pre = await orderRef.get();
    if (!pre.exists) {
      console.error(`[NOTIF] Order ${order_id} tidak ditemukan.`);
      await logFailedNotification('order_not_found', notif);
      return res.status(200).json({ status: 'OK' }); // 200: retry tidak akan membantu
    }
    const preOrder = pre.data();

    // ── 4. Cocokkan nominal ──────────────────────────────────
    if (isSuccess && Number(gross_amount) !== Number(preOrder.price)) {
      console.error(`[NOTIF] Nominal tidak cocok ${order_id}: ${gross_amount} vs ${preOrder.price}`);
      await logFailedNotification('amount_mismatch', notif, preOrder);
      return res.status(200).json({ status: 'OK' });
    }

    // ── 5. Transaksi: idempoten ──────────────────────────────
    let outcome = 'noop';
    await db.runTransaction(async (t) => {
      const oSnap = await t.get(orderRef);
      const order = oSnap.data();

      if (order.applied === true) { outcome = 'already_applied'; return; }

      const meta = {
        transaction_status,
        fraud_status: fraud_status || null,
        gross_amount: Number(gross_amount),
        updatedAt:    new Date().toISOString(),
      };

      if (!isSuccess) {
        // Jangan menurunkan order yang sudah sukses.
        if (order.status !== 'success') t.set(orderRef, { status, ...meta }, { merge: true });
        outcome = 'not_success';
        return;
      }

      if (!order.uid) {
        t.set(orderRef, { status: 'success', ...meta }, { merge: true });
        outcome = 'missing_uid';
        return;
      }

      const subRef  = db.collection('users').doc(order.uid).collection('subscription').doc('data');
      const subSnap = await t.get(subRef);
      const { fields, extending } = computeSubscription(
        subSnap.exists ? subSnap.data() : undefined, order, new Date());

      t.set(subRef, { ...fields, orderId: order_id }, { merge: true });
      t.set(orderRef, { status: 'success', ...meta, applied: true, appliedAt: new Date().toISOString() }, { merge: true });
      outcome = extending ? 'extended' : 'activated';
    });

    if (outcome === 'missing_uid') {
      await logFailedNotification('missing_uid', notif, preOrder);
    }
    console.log(`[NOTIF] ${order_id} → ${outcome}`);
    return res.status(200).json({ status: 'OK', order_id });

  } catch (err) {
    console.error('[WEBHOOK ERROR]', err);
    // 500 → Midtrans akan mengirim ulang; aman karena pemrosesan idempoten.
    return res.status(500).json({ error: 'internal' });
  }
}

// api/notification.js
// Webhook dari Midtrans → update subscription user di Firestore
import midtransClient from 'midtrans-client';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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

// Catat notifikasi yang "nyangkut" (order tidak ketemu / tidak ada uid) ke
// Firestore, bukan cuma console.log — log Vercel default cuma nyimpen
// beberapa waktu terakhir (gampang kelewat), sementara collection ini bisa
// dicek kapan saja lewat Firestore Console atau admin panel.
async function logFailedNotification(reason, notif, orderData = null) {
  try {
    await db.collection('failed_notifications').add({
      reason,
      orderIdFromWebhook: notif.order_id ?? null,
      transactionId:      notif.transaction_id ?? null,
      paymentType:         notif.payment_type ?? null,
      transactionStatus:   notif.transaction_status ?? null,
      fraudStatus:         notif.fraud_status ?? null,
      grossAmount:         notif.gross_amount ? Number(notif.gross_amount) : null,
      orderDataFound:      orderData,
      resolved:            false,
      createdAt:           new Date().toISOString(),
    });
  } catch (logErr) {
    console.error('[NOTIF] Gagal simpan failed_notifications:', logErr.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // ── 1. Verifikasi notifikasi dari Midtrans ───────────────────
    const apiClient = new midtransClient.CoreApi({
      isProduction: true,
      serverKey:    process.env.MIDTRANS_SERVER_KEY,
      clientKey:    process.env.MIDTRANS_CLIENT_KEY,
    });

    const rawNotif = await apiClient.transaction.notification(req.body);

    // Konfirmasi resmi dari Midtrans Support: untuk channel DANA, BSI VA,
    // SeaBank VA, dan Danamon VA, field order_id pada body webhook TIDAK
    // bisa diandalkan sebagai identifier — channel-channel ini pakai
    // transaction_id sebagai acuan. Daripada bikin daftar channel yang
    // harus di-cek manual (rawan kelewat kalau ada channel baru), kita
    // SELALU re-fetch status resmi via GET Transaction Status pakai
    // transaction_id, lalu pakai order_id yang beneran valid dari situ —
    // ini juga sekaligus memverifikasi notifikasi langsung dari Midtrans
    // (bukan cuma percaya body webhook mentah), lebih aman untuk semua
    // channel, bukan cuma yang 4 itu.
    let notif = rawNotif;
    try {
      const statusResp = await apiClient.transaction.status(rawNotif.transaction_id);
      notif = { ...rawNotif, ...statusResp };
    } catch (statusErr) {
      console.error(`[NOTIF] Gagal fetch status via transaction_id=${rawNotif.transaction_id}:`, statusErr.message);
      // Tetap lanjut pakai data webhook mentah sebagai fallback terakhir,
      // supaya webhook tidak gagal total kalau status API sedang bermasalah.
    }

    const { order_id, transaction_status, fraud_status, gross_amount } = notif;

    console.log(`[NOTIF] ${order_id} | ${transaction_status} | fraud: ${fraud_status} | payment_type: ${notif.payment_type}`);

    // ── 2. Tentukan status ───────────────────────────────────────
    const isSuccess = (
      transaction_status === 'settlement' ||
      (transaction_status === 'capture' && fraud_status === 'accept')
    );
    const isFailed = ['cancel', 'deny', 'expire'].includes(transaction_status);
    const status   = isSuccess ? 'success' : isFailed ? 'failed' : 'pending';

    // ── 3. Update collection orders ──────────────────────────────
    await db.collection('orders').doc(order_id).set({
      status,
      transaction_status,
      fraud_status:    fraud_status || null,
      gross_amount:    Number(gross_amount),
      updatedAt:       new Date().toISOString(),
    }, { merge: true });

    // ── 4. Jika sukses → update subscription user ────────────────
    if (isSuccess) {
      // Ambil data order untuk tahu uid, plan, dan durasi
      const orderSnap = await db.collection('orders').doc(order_id).get();
      if (!orderSnap.exists) {
        console.error(`[NOTIF] Order ${order_id} tidak ditemukan di Firestore.`);
        await logFailedNotification('order_not_found', notif);
        return res.status(200).json({ status: 'OK' }); // tetap 200 agar Midtrans tidak retry
      }

      const order = orderSnap.data();
      const { uid, plan, billing, months } = order;

      if (!uid) {
        // Tidak ada uid → tidak bisa update subscription
        // Bisa terjadi kalau user buka subscribe.html tanpa dari app
        console.warn(`[NOTIF] Order ${order_id} tidak punya uid. Skip subscription update.`);
        await logFailedNotification('missing_uid', notif, order);
        return res.status(200).json({ status: 'OK' });
      }

      // ── Hitung expiredAt ─────────────────────────────────────
      const now = new Date();

      // Cek apakah user sudah punya subscription aktif yang belum expired
      // Kalau iya, perpanjang dari tanggal expiry yang ada (bukan dari sekarang)
      const subSnap = await db
        .collection('users').doc(uid)
        .collection('subscription').doc('data')
        .get();

      let baseDate = now;
      if (subSnap.exists) {
        const existing = subSnap.data();
        if (
          existing.plan === plan &&
          existing.status === 'active' &&
          existing.expiredAt
        ) {
          const existingExpiry = new Date(existing.expiredAt);
          if (existingExpiry > now) {
            // Perpanjang dari tanggal expiry yang ada
            baseDate = existingExpiry;
            console.log(`[NOTIF] Perpanjang dari ${existingExpiry.toISOString()}`);
          }
        }
      }

      const expiredAt = new Date(baseDate);
      expiredAt.setMonth(expiredAt.getMonth() + (months || 1));

      // ── Update subscription di Firestore ──────────────────────
      await db
        .collection('users').doc(uid)
        .collection('subscription').doc('data')
        .set({
          plan,
          billing,
          status:     'active',
          expiredAt:  expiredAt.toISOString(),
          orderId:    order_id,
          startedAt:  now.toISOString(),
          lastPaidAt: now.toISOString(),
        }, { merge: true });

      console.log(`[SUBSCRIPTION] uid=${uid} plan=${plan}/${billing} expiredAt=${expiredAt.toISOString()}`);
    }

    // ── 5. Selalu balas 200 agar Midtrans tidak retry ────────────
    return res.status(200).json({ status: 'OK', order_id });

  } catch (err) {
    console.error('[WEBHOOK ERROR]', err);
    // Tetap 200 untuk transaksi yang sudah diproses (idempotent)
    return res.status(500).json({ error: err.message });
  }
}

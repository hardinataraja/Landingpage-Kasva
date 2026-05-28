// api/pay.js
import midtransClient from 'midtrans-client';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const snap = new midtransClient.Snap({
      isProduction: true,
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
    });

    const { order_id, gross_amount, item_name, customer_name, customer_email } = req.body;
    const origin = req.headers.origin || 'https://' + req.headers.host;
    const finalOrderId = order_id || `KSV-${Date.now()}`;

    const parameter = {
      transaction_details: {
        order_id: finalOrderId,
        gross_amount: gross_amount || 35000,
      },
      item_details: [{
        id: 'kasva-pos',
        price: gross_amount || 35000,
        quantity: 1,
        name: item_name || 'Kasva POS - Lifetime License',
      }],
      customer_details: {
        first_name: customer_name || 'Customer',
        email: customer_email || 'customer@email.com',
      },
      callbacks: {
        finish: `${origin}/?status=success&order_id=${finalOrderId}`,
        unfinish: `${origin}/?status=pending&order_id=${finalOrderId}`,
        error: `${origin}/?status=error&order_id=${finalOrderId}`,
      },
    };

    const transaction = await snap.createTransaction(parameter);

    // Simpan order awal ke Firestore dengan status pending
    await db.collection('payments').doc(finalOrderId).set({
      order_id: finalOrderId,
      status: 'pending',
      transaction_status: 'pending',
      gross_amount: gross_amount || 35000,
      customer_name: customer_name || 'Customer',
      customer_email: customer_email || 'customer@email.com',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return res.status(200).json({
      token: transaction.token,
      redirect_url: transaction.redirect_url,
      order_id: finalOrderId,
    });

  } catch (error) {
    console.error('Midtrans error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

// api/pay.js - Vercel Serverless Function
const midtransClient = require('midtrans-client');

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const snap = new midtransClient.Snap({
    isProduction: false, // true untuk live
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
  });

  const { order_id, gross_amount, item_name, customer_name, customer_email } = req.body;

  const parameter = {
    transaction_details: {
      order_id: order_id || `KSV-${Date.now()}`,
      gross_amount: gross_amount || 35000
    },
    item_details: [{
      id: 'kasva-pos',
      price: gross_amount || 35000,
      quantity: 1,
      name: item_name || 'Kasva POS - Lifetime License'
    }],
    customer_details: {
      first_name: customer_name || 'Customer',
      email: customer_email || 'customer@email.com'
    },
    // Redirect setelah pembayaran
    callbacks: {
      finish: 'https://kasva.com/?status=success',
      unfinish: 'https://kasva.com/?status=pending',
      error: 'https://kasva.com/?status=error'
    }
  };

  try {
    const transaction = await snap.createTransaction(parameter);
    res.status(200).json({ token: transaction.token, redirect_url: transaction.redirect_url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

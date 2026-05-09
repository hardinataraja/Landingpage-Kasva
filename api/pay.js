// api/pay.js - ESM format
import midtransClient from 'midtrans-client';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const snap = new midtransClient.Snap({
      isProduction: false,
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY
    });

    const { order_id, gross_amount, item_name, customer_name, customer_email } = req.body;

    // Get origin untuk callback URL
    const origin = req.headers.origin || 'https://' + req.headers.host;

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
      // TAMBAH INI: Callback URLs
      callbacks: {
        finish: `${origin}/?status=success&order_id=${order_id}`,
        unfinish: `${origin}/?status=pending&order_id=${order_id}`,
        error: `${origin}/?status=error&order_id=${order_id}`
      }
    };

    const transaction = await snap.createTransaction(parameter);
    
    return res.status(200).json({ 
      token: transaction.token,
      redirect_url: transaction.redirect_url 
    });
    
  } catch (error) {
    console.error('Midtrans error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
}

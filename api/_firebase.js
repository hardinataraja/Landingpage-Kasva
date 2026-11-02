// api/_firebase.js — helper bersama (diawali "_" sehingga BUKAN endpoint Vercel)
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

export const db = getFirestore();

const ALLOWED_ORIGINS = ['https://kasva.store', 'https://www.kasva.store'];

// CORS: hanya origin Kasva. Request same-origin (tanpa header Origin) tetap lolos.
export function applyCors(req, res, methods) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Verifikasi Firebase ID token dari header "Authorization: Bearer <token>".
// uid SELALU diambil dari token, tidak pernah dari body/query.
export async function requireUser(req) {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!m) throw Object.assign(new Error('unauthorized'), { status: 401 });
  try {
    return await getAuth().verifyIdToken(m[1]);
  } catch {
    throw Object.assign(new Error('unauthorized'), { status: 401 });
  }
}

// api/config.js — konfigurasi publik untuk halaman subscribe.
// FIREBASE_WEB_API_KEY  = Web API Key proyek Firebase (Project settings → General).
// GOOGLE_WEB_CLIENT_ID  = OAuth Web client ID (untuk tombol "Masuk dengan Google").
// Keduanya publik by design, tetapi diletakkan di env agar tidak di-hardcode di repo.
export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({
    firebaseApiKey: process.env.FIREBASE_WEB_API_KEY || null,
    googleClientId: process.env.GOOGLE_WEB_CLIENT_ID || null,
  });
}

# Perubahan Website Kasva (kasva.store) — pendamping migrasi consumption-only

## Mengapa website harus diubah
Aplikasi Android tidak lagi membuka `kasva.store/subscribe?uid=...`. Sebelumnya **uid hanya datang dari link di app**; `subscribe.html` tidak punya login. Tanpa perubahan, pembayaran baru tidak punya `uid`, webhook mencatat `missing_uid`, dan **pelanggan membayar tetapi tidak mendapat langganan**. Maka website kini memegang registrasi, login, dan pembelian, sesuai target arsitektur.

## Ringkasan perubahan
| File | Perubahan |
|---|---|
| `subscribe.html` | Tambah **daftar / masuk / lupa password / verifikasi email** (Firebase Auth REST). uid tidak lagi dari URL. Email dikunci ke akun. Status pembayaran dibaca dari server (`/api/check-payment`), bukan dari parameter URL. |
| `api/pay.js` | **Wajib login**: Firebase ID token diverifikasi, `uid` & `email` dari token (body diabaikan). Wajib email terverifikasi (sama seperti aplikasi). Validasi nama/HP, order ID lebih unik, error internal tidak dibocorkan, CORS dibatasi ke kasva.store. |
| `api/notification.js` | **Idempoten** (transaksi Firestore + flag `applied`) — sebelumnya notifikasi settlement ganda memperpanjang dua kali. Cocokkan `gross_amount` dengan harga order. Order tidak ditemukan tidak lagi dibuat "hantu". Status sukses tidak ditimpa notifikasi pending/expire yang terlambat. Penjumlahan bulan aman (31 Jan + 1 bln = 28 Feb). `startedAt` dipertahankan saat perpanjangan. |
| `api/check-payment.js` | Hanya mengembalikan `status`, `transaction_status`, `applied`. **Sebelumnya mengembalikan seluruh order (nama, email, HP, uid) ke siapa pun yang tahu order_id.** |
| `api/profile.js` (baru) | Membuat `users/{uid}` dengan skema yang sama dengan pendaftaran di app (idempoten) agar akun web bisa login mulus di app. |
| `api/config.js` (baru) | Menyajikan `FIREBASE_WEB_API_KEY` dan `GOOGLE_WEB_CLIENT_ID` dari env. |
| Login Google (`subscribe.html`, `vercel.json`) | Tombol **Masuk dengan Google** (Google Identity Services → Firebase `signInWithIdp`). Akun Google yang sama dengan di aplikasi menghasilkan **UID yang sama**. CSP ditambah `https://accounts.google.com`. |
| `api/_firebase.js`, `api/_subscription.js` (baru) | Helper bersama; logika perpanjangan murni + teruji. |
| `index.html` | Hapus teks usang: "Buka App → Tap Upgrade", "Browser terbuka otomatis", "Beli sekali Rp35.000", "Download APK sekarang". Langkah baru: buat akun → bayar di website → login di app. |
| `vercel.json` | Perbaiki route `/privacy-policy` (menunjuk ke file yang tidak ada; file aslinya `privacy_policy.html`). Hapus `Access-Control-Allow-Origin: *` global. |
| `.env.example`, `test/`, `package.json` | Dokumentasi env, uji logika (`npm test`). |

Tidak diubah: harga, Midtrans (kunci, mode produksi, alur Snap), struktur Firestore, kunci `orders` / `users/{uid}/subscription/data`.

## Tindakan manual (WAJIB sebelum deploy)
1. **Vercel env**: tambah `FIREBASE_WEB_API_KEY` (Firebase Console → Project settings → General → *Web API Key*). Tanpa ini halaman menampilkan "Layanan masuk belum dikonfigurasi". Jika key dibatasi, izinkan HTTP referrer `https://kasva.store/*` dan API **Identity Toolkit** + **Token Service**.
2. **Firebase Auth**: pastikan provider **Email/Password** dan **Google** aktif.
2b. **Login Google di web — env + OAuth origin (WAJIB agar tombol berfungsi):**
   - Vercel env `GOOGLE_WEB_CLIENT_ID` = `110994025196-sk7v089m3ktricqs7hmrjo6n8nj6n95k.apps.googleusercontent.com` (OAuth Web client dari `google-services.json`, client_type 3).
   - Google Cloud Console → APIs & Services → Credentials → buka client Web tersebut → **Authorized JavaScript origins**: tambahkan `https://kasva.store` (dan `https://www.kasva.store` bila dipakai). Tanpa ini Google menolak dengan `origin_mismatch`.
3. **Firestore Rules**: koleksi `orders` dan `failed_notifications` hanya ditulis/dibaca backend (Admin SDK) — tutup dari client: `match /orders/{id} { allow read, write: if false; }` dan sama untuk `failed_notifications`. Plus blok `subscription` di `app/docs/FIRESTORE_MIGRATION.md`.
4. **Rotasi bila perlu**: `kasva-release.jks`/`key.properties` ada di ZIP aplikasi (bukan website).
5. **Uji end-to-end** (lihat bawah) sebelum aplikasi baru dirilis. Urutan rilis aman: deploy website → uji → rilis aplikasi.

## Uji yang sudah dijalankan
- `node test/subscription.test.mjs`: 8/8 lulus (aktivasi baru, perpanjangan dari sisa masa aktif, expired, status non-aktif, Timestamp, akhir bulan, kabisat, tahunan).
- `node --check` semua file `api/*.js` dan JS inline `subscribe.html`.

## Yang BELUM diuji (tidak ada akses Firebase/Midtrans/browser di sini)
Login/daftar/verifikasi di browser, pembuatan Snap token, pembayaran sandbox, webhook asli, dan idempotensi di Firestore sungguhan. Uji dengan akun baru: daftar → verifikasi → bayar (idealnya kunci sandbox dulu) → kirim ulang notifikasi settlement dari dashboard Midtrans dan pastikan `expiredAt` **tidak** bertambah dua kali → login di app → cek Langganan Saya.

## Keterbatasan / keputusan terbuka
1. **Login Google di web** sudah ada, tetapi belum diuji. Bila email sudah terdaftar sebagai akun email+password yang belum tertaut Google, login Google ditolak dengan pesan agar memakai email & password (perilaku pengaturan "satu akun per email" Firebase). Tombol tidak muncul di browser dalam aplikasi lain (mis. in-app browser) dan bila `GOOGLE_WEB_CLIENT_ID` belum diisi; login email tetap tersedia.
2. **Refund/chargeback tidak dicabut otomatis** (status Midtrans `refund`, `chargeback` belum ditangani). Perlu keputusan bisnis.
3. **Pembayaran tanpa uid yang lama** (`failed_notifications` dengan `missing_uid`) perlu direkonsiliasi manual — pelanggan yang sudah membayar tetapi tak mendapat langganan.
4. **CSP** masih memuat `'unsafe-eval'` dan `vercel.json` memakai `routes` bersamaan dengan `headers` (Vercel biasanya menolak kombinasi itu). Saya tidak mengubahnya agar tidak memutus pembayaran; verifikasi bahwa header CSP benar-benar terkirim di produksi.
5. **Compliance Play**: website boleh menampilkan harga dan ajakan beli (di luar app). Tetapi link bagikan referral di app mengarah ke `landingpage-kasva.vercel.app` → redirect ke kasva.store yang berisi harga & tombol upgrade. Itu bagian risiko referral di `GOOGLE_PLAY_COMPLIANCE_REVIEW.md`.

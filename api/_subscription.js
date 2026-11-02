// api/_subscription.js — logika murni (tanpa I/O) agar bisa diuji.

// Tambah bulan dengan penjepitan hari (31 Jan + 1 bln = 28/29 Feb, bukan 3 Mar).
export function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate(); // Firestore Timestamp
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// existing = isi users/{uid}/subscription/data (atau undefined)
// order    = { plan, billing, months }
// Mengembalikan field yang harus di-merge ke dokumen subscription.
// Perpanjangan memakai sisa masa aktif: expiredAt_baru = max(sekarang, expiredAt_lama) + periode.
export function computeSubscription(existing, order, now = new Date()) {
  let base = now;
  let extending = false;
  if (existing && existing.plan === order.plan && existing.status === 'active') {
    const exp = toDate(existing.expiredAt);
    if (exp && exp > now) { base = exp; extending = true; }
  }
  const expiredAt = addMonths(base, order.months || 1);
  const out = {
    plan:       order.plan,
    billing:    order.billing,
    status:     'active',
    expiredAt:  expiredAt.toISOString(),
    lastPaidAt: now.toISOString(),
  };
  // startedAt: tetap tanggal awal bila memperpanjang langganan yang masih aktif.
  if (!extending || !existing.startedAt) out.startedAt = now.toISOString();
  return { fields: out, extending };
}

// ─── Output sanitization utilities (poin 2 XSS hardening) ───────────────────
// Semua data user yang dirender ke DOM harus melewati salah satu helper di
// bawah ini:
//   - escapeHtml(str)   → untuk nilai yang dirender sebagai TEKS.
//   - sanitizeHtml(str) → untuk string HTML yang memang harus dirender sebagai
//                         HTML (memakai DOMPurify dari CDN; fallback ke
//                         escapeHtml bila DOMPurify tidak termuat).

// Entity dibangun via konkatenasi agar sumber tetap terbaca teks biasa
// (menghindari masalah encoding di tooling/editor).
const AMP = '&' + 'amp;'
const LT = '&' + 'lt;'
const GT = '&' + 'gt;'
const QUOT = '&' + 'quot;'
const APOS = '&' + '#39;'

export function escapeHtml(value) {
  const map = { '&': AMP, '<': LT, '>': GT, '"': QUOT, "'": APOS }
  return String(value ?? '').replace(/[&<>"']/g, (c) => map[c])
}

export function sanitizeHtml(value) {
  if (typeof value !== 'string') return ''
  if (window.DOMPurify) return window.DOMPurify.sanitize(value)
  // Fallback paling aman bila DOMPurify belum termuat: perlakukan sebagai teks.
  return escapeHtml(value)
}

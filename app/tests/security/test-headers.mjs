/**
 * Smoke test Security Headers (Fase 2 hardening).
 *
 * Memverifikasi middleware keamanan (helmet + Permissions-Policy + CSP)
 * menghasilkan header yang diharapkan pada respons.
 *
 * Jalankan dari folder app:
 *   node tests/security/test-headers.mjs
 */

import express from 'express'
import { securityMiddleware } from '../../middleware/security.js'

const app = express()
app.use(securityMiddleware)
app.get('/', (_req, res) => res.send('<html><body>ok</body></html>'))
app.get('/api/ping', (_req, res) => res.json({ ok: true }))

const server = app.listen(0)
const port = server.address().port
const base = `http://127.0.0.1:${port}`

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`  ✅ ${name}`)
  } else {
    failures++
    console.error(`  ❌ ${name}`)
  }
}

try {
  console.log('Security headers test\n')

  const res = await fetch(`${base}/api/ping`, { headers: { Accept: 'application/json' } })
  const h = res.headers

  const csp = h.get('content-security-policy') || ''
  check('Content-Security-Policy ada', csp.length > 0)
  check("CSP: frame-ancestors 'none'", csp.includes("frame-ancestors 'none'"))
  check('CSP: base-uri self', csp.includes("base-uri 'self'"))
  check('CSP: object-src none', csp.includes("object-src 'none'"))
  check('CSP: form-action self', csp.includes("form-action 'self'"))

  check('Cross-Origin-Opener-Policy: same-origin', h.get('cross-origin-opener-policy') === 'same-origin')
  check('Cross-Origin-Resource-Policy: same-site', h.get('cross-origin-resource-policy') === 'same-site')
  check('X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff')
  check('X-Frame-Options: DENY', h.get('x-frame-options') === 'DENY')
  check('Referrer-Policy: no-referrer', h.get('referrer-policy') === 'no-referrer')
  check('Permissions-Policy: camera=(self)', (h.get('permissions-policy') || '').includes('camera=(self)'))
  check('X-XSS-Protection TIDAK ada (deprecated)', h.get('x-xss-protection') === null)

  // Halaman HTML tidak boleh ter-cache (mencegah cache halaman setelah logout)
  const htmlRes = await fetch(`${base}/`, { headers: { Accept: 'text/html' } })
  const cache = htmlRes.headers.get('cache-control') || ''
  check('HTML: Cache-Control no-store', cache.includes('no-store'))

  console.log(`\n${failures === 0 ? '🎉 SEMUA TES LULUS' : `💥 ${failures} tes gagal`}`)
} finally {
  server.close()
  process.exit(failures === 0 ? 0 : 1)
}

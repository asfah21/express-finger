/**
 * Tes fungsional mandiri untuk alur CSRF (Fase 1 hardening).
 *
 * Membuktikan:
 * 1. GET pertama mengeset cookie `csrf-token` (nilai "token|hash").
 * 2. Request tanpa cookie sesi (klien API-key / anonymous) → TIDAK dicek CSRF.
 * 3. Request dengan cookie sesi `token` (browser) tanpa header CSRF → 403.
 * 4. Browser dengan cookie sesi + header CSRF → 200.
 * 5. Endpoint bypass (login, /iclock, heartbeat) tetap 200 tanpa token.
 * 6. Token CSRF salah → 403.
 *
 * Catatan: Node fetch tidak menyimpan cookie otomatis seperti browser, jadi
 * tes ini mengirim header Cookie secara manual (mensimulasikan browser).
 *
 * Jalankan dari folder app:
 *   node tests/security/test-csrf-flow.mjs
 */

import express from 'express'
import cookieParser from 'cookie-parser'
import {
  csrfTokenProvider,
  csrfProtection,
  invalidCsrfTokenError,
} from '../../middleware/csrf.js'

const COOKIE = 'csrf-token'
const HEADER = 'x-csrf-token'

// Ambil nilai cookie mentah (ter-URL-encode) dari header Set-Cookie.
function rawCookie(setCookieHeader, name) {
  const entry = setCookieHeader.find((c) => c.startsWith(`${name}=`))
  return entry ? entry.split(';')[0].slice(`${name}=`.length) : ''
}

const app = express()
app.use(express.json())
app.use(cookieParser())
app.use(csrfTokenProvider)
app.use(csrfProtection)

app.get('/api/test', (_req, res) => res.json({ ok: true }))
app.post('/api/test', (_req, res) => res.json({ ok: true }))
app.post('/iclock/cdata', (_req, res) => res.send('OK'))
app.post('/api/sessions/heartbeat', (_req, res) => res.json({ ok: true }))
app.post('/auth/login', (_req, res) => res.json({ ok: true }))

// Error handler meniru globalErrorHandler di server.js
app.use((err, _req, res, _next) => {
  if (err === invalidCsrfTokenError || err?.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ status: 'error', message: 'Invalid CSRF token' })
  }
  return res.status(500).json({ status: 'error', message: err.message })
})

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

// POST dengan simulasi cookie browser + header CSRF.
const post = (path, { csrfCookie = '', csrfHeader = '', sessionCookie = '' } = {}) => {
  const cookies = []
  if (csrfCookie) cookies.push(`${COOKIE}=${csrfCookie}`)
  if (sessionCookie) cookies.push(`token=${sessionCookie}`)
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
      ...(csrfHeader ? { [HEADER]: csrfHeader } : {}),
    },
  })
}

try {
  console.log('CSRF flow test\n')

  // 1. GET → cookie csrf-token diset (nilai URL-encoded "token|hash")
  const getRes = await fetch(`${base}/api/test`)
  const setCookie = getRes.headers.getSetCookie?.() || []
  const rawValue = rawCookie(setCookie, COOKIE)
  check('GET mengeset cookie csrf-token', rawValue.length > 0)

  // Cookie yang dikirim browser adalah nilai ter-decode; token = bagian sebelum '|'.
  const fullCookie = decodeURIComponent(rawValue)
  const token = fullCookie.split('|')[0]
  check('Cookie berisi token|hash', fullCookie.includes('|') && token.length > 0)

  // 2. Tanpa cookie sesi (API-key client) → CSRF dilewati
  const apiKeyStyle = await post('/api/test')
  check('POST tanpa cookie sesi → 200 (API-key client)', apiKeyStyle.status === 200)

  // 3. Dengan cookie sesi (browser) tanpa header CSRF → 403
  const browserNoCsrf = await post('/api/test', { sessionCookie: 'some-jwt' })
  check('POST browser tanpa header CSRF → 403', browserNoCsrf.status === 403)

  // 4. Browser dengan cookie sesi + header CSRF → 200
  const browserOk = await post('/api/test', {
    sessionCookie: 'some-jwt',
    csrfCookie: fullCookie,
    csrfHeader: token,
  })
  check('POST browser dengan CSRF → 200', browserOk.status === 200)

  // 5. Endpoint bypass tetap bisa tanpa token
  const iclock = await post('/iclock/cdata', { sessionCookie: 'some-jwt' })
  check('POST /iclock/cdata tanpa CSRF → 200 (bypass)', iclock.status === 200)

  const heartbeat = await post('/api/sessions/heartbeat', { sessionCookie: 'some-jwt' })
  check('POST /api/sessions/heartbeat tanpa CSRF → 200 (bypass)', heartbeat.status === 200)

  const login = await post('/auth/login', { sessionCookie: 'some-jwt' })
  check('POST /auth/login tanpa CSRF → 200 (bypass)', login.status === 200)

  // 6. Token salah → 403 (meski cookie benar)
  const badToken = await post('/api/test', {
    sessionCookie: 'some-jwt',
    csrfCookie: fullCookie,
    csrfHeader: 'bogus-token-value',
  })
  check('POST dengan token salah → 403', badToken.status === 403)

  console.log(`\n${failures === 0 ? '🎉 SEMUA TES LULUS' : `💥 ${failures} tes gagal`}`)
} finally {
  server.close()
  process.exit(failures === 0 ? 0 : 1)
}

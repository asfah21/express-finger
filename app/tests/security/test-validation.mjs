/**
 * Tes validasi input server (Fase 3 — express-validator).
 *
 * Membuktikan input buruk (oversize / tipe salah / role tidak dikenal) ditolak
 * 400, sedangkan input wajar lolos ke handler.
 *
 * Jalankan dari folder app:
 *   node tests/security/test-validation.mjs
 */

import express from 'express'
import { validate, loginRules, employeeRules, addUserRules, updateUserRoleRules, deviceRules } from '../../middleware/validate.js'

const app = express()
app.use(express.json())

// Route uji yang meneruskan bila validasi lolos
app.post('/login', validate(loginRules), (_req, res) => res.json({ ok: true }))
app.post('/employees', validate(employeeRules), (_req, res) => res.json({ ok: true }))
app.post('/users', validate(addUserRules), (_req, res) => res.json({ ok: true }))
app.put('/users/:id/role', validate(updateUserRoleRules), (_req, res) => res.json({ ok: true }))
app.post('/devices', validate(deviceRules), (_req, res) => res.json({ ok: true }))

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

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const put = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

try {
  console.log('Input validation test\n')

  // Login
  const loginOk = await post('/login', { username: 'superadmin', password: 'rahasia123' })
  check('login valid → 200', loginOk.status === 200)

  const loginNoUser = await post('/login', { username: '', password: 'x' })
  check('login tanpa username → 400', loginNoUser.status === 400)

  const loginLongPass = await post('/login', { username: 'a', password: 'x'.repeat(200) })
  check('login password >128 → 400', loginLongPass.status === 400)

  // Employee
  const empOk = await post('/employees', { user_id: 'EMP001', nama: 'Budi', nik: '123' })
  check('employee valid → 200', empOk.status === 200)

  const empLongName = await post('/employees', { user_id: 'E1', nama: 'x'.repeat(200) })
  check('employee nama >150 → 400', empLongName.status === 400)

  const empNoUserId = await post('/employees', { nama: 'Tanpa ID' })
  check('employee tanpa user_id → 400', empNoUserId.status === 400)

  // User management
  const userOk = await post('/users', { username: 'newuser', password: 'rahasia123', role: 'viewer' })
  check('add user valid → 200', userOk.status === 200)

  const userBadRole = await post('/users', { username: 'newuser', password: 'rahasia123', role: 'root' })
  check('add user role tidak dikenal → 400', userBadRole.status === 400)

  const userShortPass = await post('/users', { username: 'newuser', password: '123' })
  check('add user password <6 → 400', userShortPass.status === 400)

  const roleOk = await put('/users/1/role', { role: 'admin' })
  check('update role valid → 200', roleOk.status === 200)

  const roleBad = await put('/users/1/role', { role: 'root' })
  check('update role tidak dikenal → 400', roleBad.status === 400)

  // Device
  const devOk = await post('/devices', { sn: 'ZK123', ip: '192.168.1.10', port: 4370 })
  check('device valid → 200', devOk.status === 200)

  const devNoIp = await post('/devices', { sn: 'ZK123' })
  check('device tanpa ip → 400', devNoIp.status === 400)

  const devBadPort = await post('/devices', { sn: 'ZK123', ip: '1.1.1.1', port: 99999 })
  check('device port >65535 → 400', devBadPort.status === 400)

  console.log(`\n${failures === 0 ? '🎉 SEMUA TES LULUS' : `💥 ${failures} tes gagal`}`)
} finally {
  server.close()
  process.exit(failures === 0 ? 0 : 1)
}

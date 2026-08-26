/**
 * IP Guard untuk protokol perangkat ZK (/iclock)
 *
 * /iclock adalah endpoint tanpa autentikasi yang dipakai mesin absensi
 * (ZKTeco/Solution) untuk push data lewat HTTP. Karena tidak ada sesi, satu
 * lapisan pertahanan yang efektif adalah membatasi IP asal.
 *
 * - Jika ICLOCK_ALLOWED_IPS dikonfigurasi (dipisah koma) → hanya IP tersebut
 *   yang boleh push; selainnya ditolak 403.
 * - Jika kosong → semua IP diizinkan (backward compatible untuk LAN internal,
 *   dengan rate limit tetap aktif).
 */

import { config } from '../config/index.js'

export const iclockIpGuard = (req, res, next) => {
  const allowed = config.ICLOCK_ALLOWED_IPS
  if (!allowed || allowed.length === 0) return next()

  const ip = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
  if (allowed.includes(ip)) return next()

  console.warn(`⛔ [ICLOCK] Blocked push from unlisted IP: ${ip}`)
  return res.status(403).send('Forbidden')
}

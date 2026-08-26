/**
 * Secure path helper (poin 7 LFI hardening)
 *
 * `safeJoin` menggabungkan base dir dengan segmen yang mungkin berasal dari
 * user, lalu MEMASTIKAN hasil akhir tetap berada di dalam base dir. Mencegah
 * path traversal (../../etc/passwd).
 */

import path from 'node:path'

/**
 * @param {string} baseDir direktori dasar (absolut atau relatif)
 * @param {...string} segments segmen path (bisa berasal dari input user)
 * @returns {string} path absolut yang dijamin di dalam baseDir
 * @throws {Error} bila hasil keluar dari baseDir (traversal)
 */
export function safeJoin(baseDir, ...segments) {
  const base = path.resolve(baseDir)
  const target = path.resolve(base, ...segments)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Path traversal blocked')
  }
  return target
}

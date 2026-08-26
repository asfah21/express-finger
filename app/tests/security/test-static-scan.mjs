/**
 * Tes scan statis keamanan (Fase 4 — poin 1, 7, 8).
 *
 * Memindai kode sumber runtime untuk pola berbahaya:
 * 1. SQL Injection   → interpolasi data request (req./body./params./query.)
 *                      langsung ke dalam template literal yang dikirim ke .query()
 * 2. Command Injection → child_process / exec / execSync / spawn / spawnSync
 * 3. Code injection   → eval( / new Function(
 * 4. LFI traversal    → unit test safeJoin (utils/secure-path.js)
 *
 * Jalankan dari folder app:
 *   node tests/security/test-static-scan.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeJoin } from '../../utils/secure-path.js'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCAN_DIRS = ['controllers', 'utils', 'middleware', 'routes']
const SCAN_FILES = ['server.js', 'config/index.js']

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.js')) yield full
  }
}

async function collectFiles() {
  const files = []
  for (const d of SCAN_DIRS) {
    for await (const f of walk(path.join(APP_DIR, d))) files.push(f)
  }
  for (const f of SCAN_FILES) files.push(path.join(APP_DIR, f))
  return files
}

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✅ ${name}`)
  } else {
    failures++
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const violations = []

function reportViolation(file, line, rule) {
  const rel = path.relative(APP_DIR, file).replace(/\\/g, '/')
  violations.push(`${rel}:${line} [${rule}]`)
}

const scanFile = async (file) => {
  const src = await readFile(file, 'utf8')
  const lines = src.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const stripped = line.trim()

    // Lewati komentar
    if (stripped.startsWith('//') || stripped.startsWith('*')) continue

    // 1. Command injection
    if (/\bchild_process\b/.test(line)) reportViolation(file, i + 1, 'child_process')
    if (/\bexecSync\s*\(/.test(line)) reportViolation(file, i + 1, 'execSync')
    if (/\bspawnSync\s*\(/.test(line)) reportViolation(file, i + 1, 'spawnSync')
    // exec( / spawn( — kecuali pemanggilan method regex `.exec(`
    if (!line.includes('.exec(') && /\bexec\s*\(/.test(line)) reportViolation(file, i + 1, 'exec(')
    if (/\bspawn\s*\(/.test(line)) reportViolation(file, i + 1, 'spawn(')

    // 2. Code injection
    if (/\beval\s*\(/.test(line)) reportViolation(file, i + 1, 'eval(')
    if (/new\s+Function\s*\(/.test(line)) reportViolation(file, i + 1, 'new Function(')

    // 3. SQL injection — interpolasi data request ke template literal .query(
    //    Pola: .query(` ... ${req. | ${body. | ${params. | ${query.
    if (/\$\{(req|body|params|query)\./.test(line) && /\.query\s*\(/.test(line)) {
      reportViolation(file, i + 1, 'SQL interpolation request')
    }
  }
}

try {
  console.log('Static security scan\n')

  // 1. Path traversal (LFI) — unit test safeJoin
  const base = '/data/raw'
  const ok = safeJoin(base, 'file.txt')
  check('safeJoin: path normal valid', ok === path.resolve(base, 'file.txt'))

  let blocked1 = false
  try { safeJoin(base, '../../etc/passwd') } catch { blocked1 = true }
  check('safeJoin: ../../etc/passwd ditolak', blocked1)

  let blocked2 = false
  try { safeJoin(base, '..', '..', 'x') } catch { blocked2 = true }
  check('safeJoin: traversal bertingkat ditolak', blocked2)

  // 2. Scan statis sumber runtime
  const files = await collectFiles()
  for (const f of files) await scanFile(f)

  if (violations.length > 0) {
    console.error('\n  ⚠️ Ditemukan pola berbahaya:')
    for (const v of violations) console.error(`    - ${v}`)
    failures++
  } else {
    console.log(`  ✅ Tidak ada pola berbahaya di ${files.length} file sumber`)
  }

  console.log(`\n${failures === 0 ? '🎉 SEMUA TES LULUS' : `💥 ${failures} tes gagal`}`)
} finally {
  process.exit(failures === 0 ? 0 : 1)
}

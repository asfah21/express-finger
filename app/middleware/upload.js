/**
 * File Upload Middleware (poin 6 hardening — Multer + validasi ekstensi/mimetype)
 *
 * Siap dipasang pada endpoint multipart yang akan datang (mis. upload foto
 * wajah / file import). Validasi berlapis:
 * - Ekstensi + mimetype di-whitelist (fileFilter).
 * - Ukuran dibatasi (5MB, 1 file).
 * - Disimpan dengan nama acak (UUID) di luar public/, bukan nama asli user.
 *
 * Catatan: saat ini aplikasi belum punya endpoint multipart — import employee
 * diparse client-side (SheetJS → JSON) dan template biometrics dikirim base64
 * (JSON). Middleware ini menjadi kemampuan siap-pakai + terdokumentasi untuk
 * endpoint upload nyata di masa depan.
 *
 * Contoh pemakaian:
 *   router.post('/upload', uploadSingle('file'), handler)
 */

import multer from 'multer'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'

// Ekstensi & mimetype yang diizinkan. Sesuaikan dengan kebutuhan nyata saat
// endpoint upload diaktifkan.
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.jpg', '.jpeg', '.png'])
const ALLOWED_MIMETYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel',                                          // xls
  'text/csv',                                                          // csv
  'image/jpeg',                                                        // jpg/jpeg
  'image/png',                                                         // png
])

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('data/uploads')

// Pastikan direktori upload ada (aman: dibuat saat modul dimuat).
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  // Nama acak (UUID) + ekstensi asli yang sudah lolos whitelist.
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    cb(null, `${randomUUID()}${ext}`)
  },
})

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  const mime = String(file.mimetype || '').toLowerCase()
  if (ALLOWED_EXTENSIONS.has(ext) && ALLOWED_MIMETYPES.has(mime)) {
    return cb(null, true)
  }
  const err = new Error(`File type tidak diizinkan (${ext || mime || 'unknown'})`)
  err.status = 400
  err.name = 'FileTypeNotAllowed'
  cb(err)
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
})

/** Middleware upload satu file (field name default 'file'). */
export const uploadSingle = (fieldName = 'file') => upload.single(fieldName)

export { UPLOAD_DIR, ALLOWED_EXTENSIONS, ALLOWED_MIMETYPES, MAX_FILE_SIZE }

/**
 * Input Validation Middleware (poin 2 hardening — express-validator)
 *
 * Validasi & pembatasan input di server sebagai lapisan pertahanan pertama.
 * Fokus: tipe, panjang, dan whitelist — BUKAN mengubah nilai (.escape() TIDAK
 * dipakai agar data asli tidak berubah; sanitasi output untuk XSS dilakukan
 * di sisi klien lewat app/public/js/utils/sanitize.js + DOMPurify).
 */

import { body, query, param, validationResult } from 'express-validator'
import { sendError } from '../utils/response.js'

export const VALID_ROLES = ['superadmin', 'admin', 'viewer', 'public']

/** Jalankan semua rule lalu kirim error pertama (400) bila ada yang gagal. */
export function validate(rules) {
  return async (req, res, next) => {
    await Promise.all(rules.map((rule) => rule.run(req)))
    const errors = validationResult(req)
    if (errors.isEmpty()) return next()
    return sendError(res, errors.array()[0].msg, 400)
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────
export const loginRules = [
  body('username').trim().isLength({ min: 1, max: 50 }).withMessage('Username tidak valid'),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Password tidak valid'),
]

export const verifyRules = [
  body('password').isLength({ min: 1, max: 128 }).withMessage('Password tidak valid'),
]

export const updateAccountRules = [
  body('username').optional({ values: 'falsy' }).trim().isLength({ min: 3, max: 50 }).withMessage('Username harus 3–50 karakter'),
  body('password').optional({ values: 'falsy' }).isLength({ min: 6, max: 128 }).withMessage('Password minimal 6 karakter'),
]

export const addUserRules = [
  body('username').trim().isLength({ min: 3, max: 50 }).withMessage('Username harus 3–50 karakter'),
  body('password').isLength({ min: 6, max: 128 }).withMessage('Password minimal 6 karakter'),
  body('role').optional().isIn(VALID_ROLES).withMessage('Role tidak valid'),
]

export const resetPasswordRules = [
  param('id').isInt().withMessage('ID user tidak valid'),
  body('password').isLength({ min: 6, max: 128 }).withMessage('Password minimal 6 karakter'),
]

export const updateUserRoleRules = [
  param('id').isInt().withMessage('ID user tidak valid'),
  body('role').isIn(VALID_ROLES).withMessage('Role tidak valid'),
]

export const userIdParamRules = [
  param('id').isInt().withMessage('ID user tidak valid'),
]

// ─── Employees ───────────────────────────────────────────────────────────────
const TEXT_LIMITS = { nik: 50, nama: 150, jabatan: 150, department: 150, divisi: 150, type: 50 }

export const employeeRules = [
  body('user_id').trim().isLength({ min: 1, max: 50 }).withMessage('User ID tidak valid'),
  ...Object.entries(TEXT_LIMITS).map(([field, max]) =>
    body(field).optional({ values: 'falsy' }).trim().isLength({ max }).withMessage(`${field} terlalu panjang`)
  ),
]

export const employeeIdParamRules = [
  param('id').isInt().withMessage('ID employee tidak valid'),
]

export const employeeBulkRules = [
  body('employees').isArray({ min: 1, max: 5000 }).withMessage('Data employee tidak valid'),
  body('employees.*.user_id').trim().isLength({ min: 1, max: 50 }).withMessage('User ID tidak valid'),
  body('employees.*.nama').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
]

// Update employee: semua field opsional (user_id boleh tidak diubah).
export const employeeUpdateRules = [
  body('user_id').optional({ values: 'falsy' }).trim().isLength({ min: 1, max: 50 }).withMessage('User ID tidak valid'),
  ...Object.entries(TEXT_LIMITS).map(([field, max]) =>
    body(field).optional({ values: 'falsy' }).trim().isLength({ max }).withMessage(`${field} terlalu panjang`)
  ),
]

// ─── Devices ─────────────────────────────────────────────────────────────────
export const deviceRules = [
  body('sn').trim().isLength({ min: 1, max: 100 }).withMessage('SN device tidak valid'),
  body('name').optional({ values: 'falsy' }).trim().isLength({ max: 200 }).withMessage('Nama device terlalu panjang'),
  body('ip').trim().isLength({ min: 1, max: 100 }).withMessage('IP address tidak valid'),
  body('port').optional({ values: 'falsy' }).isInt({ min: 1, max: 65535 }).withMessage('Port tidak valid'),
]

// Update device: semua field opsional.
export const deviceUpdateRules = [
  body('sn').optional({ values: 'falsy' }).trim().isLength({ min: 1, max: 100 }).withMessage('SN device tidak valid'),
  body('name').optional({ values: 'falsy' }).trim().isLength({ max: 200 }).withMessage('Nama device terlalu panjang'),
  body('ip').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('IP address tidak valid'),
  body('port').optional({ values: 'falsy' }).isInt({ min: 1, max: 65535 }).withMessage('Port tidak valid'),
]

export const deviceIdParamRules = [
  param('id').isInt().withMessage('ID device tidak valid'),
]

// ─── Kiosk Devices ───────────────────────────────────────────────────────────
// Kiosk register memakai field body `device_id` (lihat controllers/kiosk-device.js).
export const kioskRegisterRules = [
  body('device_id').trim().isLength({ min: 1, max: 64 }).withMessage('Device ID tidak valid'),
]

export const kioskIdParamRules = [
  param('id').isInt().withMessage('ID kiosk device tidak valid'),
]

export const kioskRenameRules = [
  param('id').isInt().withMessage('ID kiosk device tidak valid'),
  body('name').trim().isLength({ max: 200 }).withMessage('Nama terlalu panjang'),
]

// ─── Sessions search (GET query) ─────────────────────────────────────────────
export const sessionSearchRules = [
  query('search').optional().trim().isLength({ max: 100 }).withMessage('Search terlalu panjang'),
  query('status').optional().isIn(['active', 'ended', 'expired', 'online', 'away', 'idle', 'all']).withMessage('Status tidak valid'),
  query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limit tidak valid'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset tidak valid'),
]

// Page permissions
export const pagePermissionRules = [
  param('id').isInt().withMessage('ID permission tidak valid'),
  body('allowed_roles').isArray({ min: 1 }).withMessage('allowed_roles harus array'),
  body('allowed_roles.*').isIn(VALID_ROLES).withMessage('Role tidak valid'),
]

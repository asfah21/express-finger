import express from 'express'
import { login, logout, me, verify, updateAccount, listUsers, addUser, deleteUser, resetUserPassword, checkDefaultUser, updateUserRole } from '../controllers/auth.js'
import {
  requireAuth,
  requireSuperAdminPrivileges,
  optionalAuth,
  loginLimiter,
  loginIpLimiter,
  verifyLimiter,
  verifyAccountLimiter,
  userManagementLimiter,
  userManagementAccountLimiter
} from '../middleware/index.js'
import { validate, loginRules, verifyRules, updateAccountRules, addUserRules, resetPasswordRules, updateUserRoleRules, userIdParamRules } from '../middleware/validate.js'

const router = express.Router()

// Validasi input (express-validator) sebagai lapisan pertahanan pertama (poin 2).
// Login dilindungi DUA lapisan: per-IP (cegah password spraying lintas-akun)
// lalu per-account (cegah brute force satu akun) — keduanya 15 menit window.
router.post('/login', loginIpLimiter, loginLimiter, validate(loginRules), login)
router.post('/logout', logout)
router.get('/me', requireAuth, me)
router.get('/check-default', checkDefaultUser)
// Verify (autentikasi ulang password utk akses settings) — per-IP + per-account.
router.post('/verify', requireAuth, verifyLimiter, verifyAccountLimiter, validate(verifyRules), verify)
router.put('/account', requireAuth, validate(updateAccountRules), updateAccount)

// User management (requires Superadmin) — operasi sensitif diberi rate limit
// ketat per-IP + per-account agar sesi superadmin yang disusupi tidak bisa
// membuat/menghapus/mereset user secara massal dalam waktu singkat.
router.get('/users', requireAuth, requireSuperAdminPrivileges, listUsers)
router.post('/users', requireAuth, requireSuperAdminPrivileges, userManagementLimiter, userManagementAccountLimiter, validate(addUserRules), addUser)
router.delete('/users/:id', requireAuth, requireSuperAdminPrivileges, userManagementLimiter, userManagementAccountLimiter, validate(userIdParamRules), deleteUser)
router.put('/users/:id/password', requireAuth, requireSuperAdminPrivileges, userManagementLimiter, userManagementAccountLimiter, validate(resetPasswordRules), resetUserPassword)
router.put('/users/:id/role', requireAuth, requireSuperAdminPrivileges, userManagementLimiter, userManagementAccountLimiter, validate(updateUserRoleRules), updateUserRole)

export default router

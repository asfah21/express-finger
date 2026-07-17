import express from 'express'
import { login, logout, me, verify, updateAccount, listUsers, addUser, deleteUser, resetUserPassword, checkDefaultUser, updateUserRole } from '../controllers/auth.js'
import { requireAuth, requireSuperAdminPrivileges, optionalAuth, loginLimiter } from '../middleware/index.js'

const router = express.Router()

router.post('/login', loginLimiter, login)
router.post('/logout', logout)
router.get('/me', requireAuth, me)
router.get('/check-default', checkDefaultUser)
router.post('/verify', requireAuth, verify)
router.put('/account', requireAuth, updateAccount)

// User management (requires Superadmin)
router.get('/users', requireAuth, requireSuperAdminPrivileges, listUsers)
router.post('/users', requireAuth, requireSuperAdminPrivileges, addUser)
router.delete('/users/:id', requireAuth, requireSuperAdminPrivileges, deleteUser)
router.put('/users/:id/password', requireAuth, requireSuperAdminPrivileges, resetUserPassword)
router.put('/users/:id/role', requireAuth, requireSuperAdminPrivileges, updateUserRole)

export default router

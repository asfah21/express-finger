import express from 'express'
import { login, logout, me, verify, updateAccount, listUsers, addUser, deleteUser, resetUserPassword, checkDefaultUser } from '../controllers/auth.js'
import { requireAuth, requireSuperAdminPrivileges, optionalAuth } from '../middleware/index.js'

const router = express.Router()

router.post('/login', login)
router.post('/logout', logout)
router.get('/me', requireAuth, me)
router.get('/check-default', checkDefaultUser)
router.post('/verify', requireAuth, verify)
router.put('/account', requireAuth, updateAccount)

// User management (requires Superadmin)
router.get('/users', requireSuperAdminPrivileges, listUsers)
router.post('/users', requireSuperAdminPrivileges, addUser)
router.delete('/users/:id', requireSuperAdminPrivileges, deleteUser)
router.put('/users/:id/password', requireSuperAdminPrivileges, resetUserPassword)

export default router

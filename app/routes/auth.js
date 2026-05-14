import express from 'express'
import { login, logout, me, verify, updateAccount, listUsers, addUser, deleteUser, resetUserPassword } from '../controllers/auth.js'
import { requireAuth, requireAdmin } from '../middleware/index.js'

const router = express.Router()

router.post('/login', login)
router.post('/logout', logout)
router.get('/me', requireAuth, me)
router.post('/verify', requireAuth, verify)
// Any user can update their own account info if we allow, but here we requireAdmin to be safe, 
// or allow requireAuth and let the controller handle it. Let's keep requireAuth for their own account.
router.put('/account', requireAuth, updateAccount)

// User management (requires Admin)
router.get('/users', requireAdmin, listUsers)
router.post('/users', requireAdmin, addUser)
router.delete('/users/:id', requireAdmin, deleteUser)
router.put('/users/:id/password', requireAdmin, resetUserPassword)

export default router

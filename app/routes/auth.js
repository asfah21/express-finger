import express from 'express'
import { login, logout, me, updateAccount, listUsers, addUser, deleteUser, resetUserPassword } from '../controllers/auth.js'
import { requireAuth } from '../middleware/index.js'

const router = express.Router()

router.post('/login', login)
router.post('/logout', logout)
router.get('/me', requireAuth, me)
router.put('/account', requireAuth, updateAccount)

// User management (requires login)
router.get('/users', requireAuth, listUsers)
router.post('/users', requireAuth, addUser)
router.delete('/users/:id', requireAuth, deleteUser)
router.put('/users/:id/password', requireAuth, resetUserPassword)

export default router

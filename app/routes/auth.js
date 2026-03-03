import express from 'express'
import { login, logout, me, updateAccount } from '../controllers/auth.js'
import { requireAuth } from '../middleware/index.js'

const router = express.Router()

router.post('/login', login)
router.post('/logout', logout)
router.get('/me', requireAuth, me)
router.put('/account', requireAuth, updateAccount)

export default router

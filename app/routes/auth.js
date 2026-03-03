import express from 'express'
import { login, logout, me } from '../controllers/auth.js'
import { requireAuth } from '../middleware/index.js'

const router = express.Router()

router.post('/login', login)
router.post('/logout', logout)
router.get('/me', requireAuth, me)

export default router

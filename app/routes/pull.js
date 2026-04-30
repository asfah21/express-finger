import { Router } from 'express'
import { pullController } from '../controllers/pull.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// Endpoint to pull data from a specific device
// We protect it with requireAuth so only logged-in users can trigger it
router.post('/', requireAuth, pullController.pullData)

export default router

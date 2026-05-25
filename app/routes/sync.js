import express from 'express'
import { syncController } from '../controllers/sync.js'
import { requireApiKey, requireAdminPrivileges } from '../middleware/index.js'

const router = express.Router()

// Sync routes - require API key or JWT
router.use(requireApiKey)

// Manual sync for a specific device
router.post('/device', syncController.syncDevice)

// Sync all active devices
router.post('/all', syncController.syncAll)

export default router

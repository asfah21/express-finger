import express from 'express'
import { liveController } from '../controllers/live.js'
import { requireApiKey, requireAuth, requireSuperAdminPrivileges } from '../middleware/index.js'

const router = express.Router()

// Kiosk attendance is intentionally available without dashboard login.
router.post('/attendance', liveController.attendance)

router.use(requireApiKey)
router.get('/health', requireAuth, liveController.pageAccess, liveController.health)
router.post('/reload', requireSuperAdminPrivileges, liveController.reload)

export default router

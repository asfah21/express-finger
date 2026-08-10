import express from 'express'
import { liveController } from '../controllers/live.js'
import { requireApiKey, requireAuth, requireSuperAdminPrivileges } from '../middleware/index.js'

const router = express.Router()

// Kiosk attendance is intentionally available without dashboard login.
router.post('/attendance', liveController.attendance)
// Multi-attendance kiosk: recognise a whole frame first, then record the batch.
router.post('/multi-recognize', liveController.recognizeMulti)
router.post('/multi-attendance', liveController.multiAttendance)

router.use(requireApiKey)
router.get('/health', requireAuth, liveController.pageAccess, liveController.health)
router.post('/reload', requireSuperAdminPrivileges, liveController.reload)

export default router

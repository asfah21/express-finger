import express from 'express'
import { liveController } from '../controllers/live.js'
import { requireApiKey, requireAuth, requireSuperAdminPrivileges, requireKioskDevice } from '../middleware/index.js'

const router = express.Router()

// Kiosk attendance is gated by an approved kiosk device (see requireKioskDevice).
// A valid JWT session (public account) + an approved x-device-id is required.
router.post('/attendance', requireKioskDevice, liveController.attendance)
// Multi-attendance kiosk: recognise a whole frame first, then record the batch.
router.post('/multi-recognize', requireKioskDevice, liveController.recognizeMulti)
router.post('/multi-attendance', requireKioskDevice, liveController.multiAttendance)

router.use(requireApiKey)
router.get('/health', requireAuth, liveController.pageAccess, liveController.health)
router.post('/reload', requireSuperAdminPrivileges, liveController.reload)

export default router

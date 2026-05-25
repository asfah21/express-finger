import express from 'express'
import { activityLogController, recordActivity } from '../controllers/activity-log.js'
import { requireAuth, requireSuperAdminPrivileges, optionalAuth } from '../middleware/index.js'
import { sendSuccess, sendError } from '../utils/response.js'

const router = express.Router()

// Route untuk activity logs (hanya user yang login)
router.get('/', requireAuth, activityLogController.getLogs)
router.delete('/old', requireSuperAdminPrivileges, activityLogController.clearOldLogs)

// Endpoint untuk mencatat aktivitas dari frontend (export, dll.)
router.post('/record', requireAuth, async (req, res) => {
    const { action, category, detail } = req.body
    const username = req.user?.username || 'unknown'
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''

    if (!action || !category) {
        return sendError(res, 'action and category are required', 400)
    }

    await recordActivity({ username, action, category, detail: detail || '', ip })
    sendSuccess(res, null, 'Activity recorded')
})

export default router

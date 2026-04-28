import express from 'express'
import { activityLogController, recordActivity } from '../controllers/activity-log.js'
import { requireAuth } from '../middleware/index.js'

const router = express.Router()

// Route untuk activity logs (hanya user yang login)
router.get('/', requireAuth, activityLogController.getLogs)
router.delete('/old', requireAuth, activityLogController.clearOldLogs)

// Endpoint untuk mencatat aktivitas dari frontend (export, dll.)
router.post('/record', requireAuth, async (req, res) => {
    const { action, category, detail } = req.body
    const username = req.user?.username || 'unknown'
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''

    if (!action || !category) {
        return res.status(400).json({ status: 'error', message: 'action and category are required' })
    }

    await recordActivity({ username, action, category, detail: detail || '', ip })
    res.json({ status: 'success', message: 'Activity recorded' })
})

export default router

import express from 'express'
import { requireApiKey } from '../middleware/index.js'
import { apiController } from '../controllers/index.js'

const router = express.Router()

// Semua route API memerlukan API key
router.use(requireApiKey)

router.get('/logs', apiController.getLogs)
router.get('/stats/daily', apiController.getDailyStats)
router.get('/raw', apiController.getRawFiles)
router.get('/raw/:name', apiController.downloadRawFile)

export default router
import express from 'express'
import { requireApiKey } from '../middleware/index.js'
import { apiController, syncController, deviceManagerController } from '../controllers/index.js'

const router = express.Router()

// Semua route API memerlukan API key
router.use(requireApiKey)

router.get('/logs', apiController.getLogs)
router.get('/stats/daily', apiController.getDailyStats)
router.get('/raw', apiController.getRawFiles)
router.get('/raw/:name', apiController.downloadRawFile)

// Sync Routes (PULL)
router.post('/sync', syncController.syncDevice)
router.post('/sync/all', syncController.syncAll)

// Device Management Routes
router.get('/devices', deviceManagerController.listDevices)
router.post('/devices', deviceManagerController.addDevice)
router.put('/devices/:id', deviceManagerController.updateDevice)
router.delete('/devices/:id', deviceManagerController.deleteDevice)

export default router
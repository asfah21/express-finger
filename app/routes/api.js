import express from 'express'
import { requireApiKey } from '../middleware/index.js'
import { apiController, syncController, deviceManagerController, employeeController, settingsController } from '../controllers/index.js'

const router = express.Router()

// Semua route API memerlukan API key
router.use(requireApiKey)

router.get('/settings', settingsController.getSettings)
router.put('/settings', settingsController.updateSettings)

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

// Employee Management Routes
router.get('/employees', employeeController.listEmployees)
router.get('/employees/:id', employeeController.getEmployee)
router.post('/employees', employeeController.addEmployee)
router.post('/employees/bulk', employeeController.bulkAddEmployees)
router.put('/employees/:id', employeeController.updateEmployee)
router.delete('/employees/:id', employeeController.deleteEmployee)

export default router
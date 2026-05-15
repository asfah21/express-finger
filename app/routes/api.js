import express from 'express'
import { requireApiKey, requireAdminPrivileges } from '../middleware/index.js'
import { apiController, syncController, deviceManagerController, employeeController, settingsController } from '../controllers/index.js'

const router = express.Router()

// Semua route API memerlukan API key (atau JWT via Dashboard)
router.use(requireApiKey)

router.get('/settings', settingsController.getSettings)
router.put('/settings', requireAdminPrivileges, settingsController.updateSettings)

router.get('/logs', apiController.getLogs)
router.get('/logs/summary', apiController.getAttendanceSummary)
router.get('/stats/daily', apiController.getDailyStats)
router.get('/raw', apiController.getRawFiles)
router.get('/raw/:name', apiController.downloadRawFile)

// Sync Routes (PULL) - allow viewer to trigger sync? Yes, usually safe to let viewers pull fresh data
router.post('/sync', syncController.syncDevice)
router.post('/sync/all', syncController.syncAll)

// Device Management Routes
router.get('/devices', deviceManagerController.listDevices)
router.post('/devices', requireAdminPrivileges, deviceManagerController.addDevice)
router.put('/devices/:id', requireAdminPrivileges, deviceManagerController.updateDevice)
router.delete('/devices/:id', requireAdminPrivileges, deviceManagerController.deleteDevice)

// Employee Management Routes
router.get('/employees', employeeController.listEmployees)
router.get('/employees/:id', employeeController.getEmployee)
router.post('/employees', requireAdminPrivileges, employeeController.addEmployee)
router.post('/employees/bulk', requireAdminPrivileges, employeeController.bulkAddEmployees)
router.put('/employees/:id', requireAdminPrivileges, employeeController.updateEmployee)
router.delete('/employees/:id', requireAdminPrivileges, employeeController.deleteEmployee)

export default router
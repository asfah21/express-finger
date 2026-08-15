import express from 'express'
import { requireApiKey, requireAdminPrivileges, requireSuperAdminPrivileges, optionalAuth } from '../middleware/index.js'
import { apiController, syncController, deviceManagerController, employeeController, settingsController, pagePermissionsController } from '../controllers/index.js'
import { getCacheMetrics, clearCache } from '../utils/cache.js'

const router = express.Router()

// Semua route API memerlukan API key (atau JWT via Dashboard)
router.use(requireApiKey)

// Cache monitoring routes (Super Admin only)
router.get('/cache-stats', requireSuperAdminPrivileges, (_req, res) => {
  const stats = getCacheMetrics()
  res.json({ status: 'ok', cache: stats })
})

router.post('/cache-flush', requireSuperAdminPrivileges, (_req, res) => {
  clearCache()
  res.json({ status: 'ok', message: 'Cache flushed successfully' })
})

router.get('/settings', requireSuperAdminPrivileges, settingsController.getSettings)
router.put('/settings', requireSuperAdminPrivileges, settingsController.updateSettings)

// Page Permissions routes (Super Admin only for management)
router.get('/page-permissions', requireSuperAdminPrivileges, pagePermissionsController.getAll)
router.put('/page-permissions/:id', requireSuperAdminPrivileges, pagePermissionsController.update)

// Get current user's accessible pages (any authenticated user)
router.get('/my-permissions', requireApiKey, pagePermissionsController.getMyPermissions)

router.get('/logs/late', apiController.getLateLogs)
router.get('/logs', apiController.getLogs)

router.get('/logs/summary', apiController.getAttendanceSummary)
router.get('/pair', apiController.getPairSummary)
router.get('/stats/daily', apiController.getDailyStats)
router.get('/stats/overview', apiController.getOverviewData)
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
router.post('/employees/bulk-delete', requireAdminPrivileges, employeeController.bulkDeleteEmployees)
router.put('/employees/:id', requireAdminPrivileges, employeeController.updateEmployee)
router.delete('/employees/:id', requireAdminPrivileges, employeeController.deleteEmployee)
router.post('/employees/:id/sync-to-device', requireAdminPrivileges, employeeController.syncEmployeeToDevice)

export default router

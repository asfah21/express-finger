import express from 'express'
import { requireApiKey, requireAdminPrivileges, requireSuperAdminPrivileges, optionalAuth } from '../middleware/index.js'
import { apiController, syncController, deviceManagerController, employeeController, settingsController, pagePermissionsController, sessionController, kioskDeviceController } from '../controllers/index.js'
import { getCacheMetrics, clearCache } from '../utils/cache.js'
import {
  validate,
  employeeRules,
  employeeUpdateRules,
  employeeBulkRules,
  employeeIdParamRules,
  deviceRules,
  deviceUpdateRules,
  deviceIdParamRules,
  kioskRegisterRules,
  kioskRenameRules,
  kioskIdParamRules,
  sessionSearchRules,
  pagePermissionRules,
} from '../middleware/validate.js'

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
router.put('/page-permissions/:id', requireSuperAdminPrivileges, validate(pagePermissionRules), pagePermissionsController.update)

// Active Sessions routes (Super Admin only)
router.get('/sessions', requireSuperAdminPrivileges, validate(sessionSearchRules), sessionController.list)
router.post('/sessions/kill-others', requireSuperAdminPrivileges, sessionController.killOthers)
router.post('/sessions/:jti/kill', requireSuperAdminPrivileges, sessionController.kill)
router.post('/sessions/user/:userId/kill', requireSuperAdminPrivileges, sessionController.killAll)

// Session heartbeat — any authenticated user, used for real-time "online" status
router.post('/sessions/heartbeat', sessionController.heartbeat)

// Kiosk device whitelist / approval (Super Admin management + kiosk registration)
router.get('/kiosk-devices', requireSuperAdminPrivileges, kioskDeviceController.list)
router.post('/kiosk-devices/register', validate(kioskRegisterRules), kioskDeviceController.register)
router.put('/kiosk-devices/:id/approve', requireSuperAdminPrivileges, validate(kioskIdParamRules), kioskDeviceController.approve)
router.put('/kiosk-devices/:id/revoke', requireSuperAdminPrivileges, validate(kioskIdParamRules), kioskDeviceController.revoke)
router.put('/kiosk-devices/:id/rename', requireSuperAdminPrivileges, validate(kioskRenameRules), kioskDeviceController.rename)
router.put('/kiosk-devices/:id/unbind', requireSuperAdminPrivileges, validate(kioskIdParamRules), kioskDeviceController.unbind)

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
router.post('/devices', requireAdminPrivileges, validate(deviceRules), deviceManagerController.addDevice)
router.put('/devices/:id', requireAdminPrivileges, validate(deviceUpdateRules), deviceManagerController.updateDevice)
router.delete('/devices/:id', requireAdminPrivileges, validate(deviceIdParamRules), deviceManagerController.deleteDevice)

// Employee Management Routes
router.get('/employees', employeeController.listEmployees)
// NOTE: must be registered BEFORE '/employees/:id' so 'departments' is not
// captured as the :id parameter.
router.get('/employees/departments', employeeController.listDepartments)
router.get('/employees/:id', employeeController.getEmployee)
router.post('/employees', requireAdminPrivileges, validate(employeeRules), employeeController.addEmployee)
router.post('/employees/bulk', requireAdminPrivileges, validate(employeeBulkRules), employeeController.bulkAddEmployees)
router.post('/employees/bulk-delete', requireAdminPrivileges, employeeController.bulkDeleteEmployees)
router.put('/employees/:id', requireAdminPrivileges, validate(employeeUpdateRules), employeeController.updateEmployee)
router.delete('/employees/:id', requireAdminPrivileges, validate(employeeIdParamRules), employeeController.deleteEmployee)
router.post('/employees/:id/sync-to-device', requireAdminPrivileges, employeeController.syncEmployeeToDevice)

export default router

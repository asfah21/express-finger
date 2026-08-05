import express from 'express'
import { templateSyncController } from '../controllers/template-sync.js'
import { requireApiKey, requireAdminPrivileges } from '../middleware/index.js'

const router = express.Router()
router.use(requireApiKey, requireAdminPrivileges)
router.post('/pull-master', templateSyncController.pullMaster)
router.post('/dry-run/:deviceId', templateSyncController.dryRun)
router.post('/push/:deviceId', templateSyncController.push)
router.post('/push-all', templateSyncController.pushAll)
router.get('/status', templateSyncController.status)
export default router

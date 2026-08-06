import express from 'express'
import { templateManualController } from '../controllers/template-manual.js'
import { requireApiKey, requireAdminPrivileges } from '../middleware/index.js'

const router = express.Router()
router.use(requireApiKey, requireAdminPrivileges)
router.get('/', templateManualController.listTemplates)
router.post('/', templateManualController.saveTemplate)
router.delete('/:id', templateManualController.deleteTemplate)
router.get('/:id/download', templateManualController.downloadTemplate)

export default router

import { Router } from 'express'
import { pullEmployeeController } from '../controllers/pull-employee.js'
import { requireApiKey } from '../middleware/auth.js'

const router = Router()

// Endpoint to pull employee data from a specific device
router.post('/', requireApiKey, pullEmployeeController.pullData)

export default router

import express from 'express'
import { deviceController } from '../controllers/index.js'

const router = express.Router()

router.post('/cdata', deviceController.handleCdata)
router.get('/cdata', deviceController.handleCdataGet)
router.get('/getrequest', deviceController.handleGetRequest)

export default router
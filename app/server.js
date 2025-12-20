// Entry point utama aplikasi
import express from 'express'
import compression from 'compression'
import { config } from './config/index.js'
import {
  corsMiddleware,
  securityMiddleware,
  loggerMiddleware
} from './middleware/index.js'
import { deviceRoutes, apiRoutes } from './routes/index.js'
import { ensureSchema, ensureRawDir, cleanupOldRawFiles } from './utils/index.js'

const app = express()

// Middleware global
app.use(compression())
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: false, limit: '20mb' }))
app.use(express.text({ type: ['text/plain', 'text/*', 'application/octet-stream'], limit: '20mb' }))
app.use(corsMiddleware)
app.use(securityMiddleware)
app.use(loggerMiddleware)

// Routes
app.use('/iclock', deviceRoutes)
app.use('/api', apiRoutes)

// Health check
app.get('/', (_req, res) =>
  res.json({ status: 'OK', service: 'GSI ADMS listener', time: new Date().toISOString() })
)

// Inisialisasi dan startup
;(async () => {
  try {
    await ensureSchema()
    await ensureRawDir()
    await cleanupOldRawFiles()
    
    // Setup cleanup interval
    setInterval(cleanupOldRawFiles, config.CLEANUP_INTERVAL_MS)
    
    app.listen(config.PORT, () => {
      console.log(`✅ GSI ADMS listener ready on port ${config.PORT}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
})()
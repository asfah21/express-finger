// Entry point utama aplikasi
import express from 'express'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import { config } from './config/index.js'
import {
  corsMiddleware,
  securityMiddleware,
  loggerMiddleware,
  apiLimiter,
  syncLimiter,
  activityLogLimiter,
  verifyLimiter
} from './middleware/index.js'
import { deviceRoutes, apiRoutes, authRoutes, activityLogRoutes, pullRoutes, pullEmployeeRoutes, syncRoutes } from './routes/index.js'
import { globalErrorHandler, notFoundHandler } from './middleware/index.js'
import { ensureSchema, ensureRawDir, cleanupOldRawFiles, pool } from './utils/index.js'
import { startPullScheduler } from './utils/scheduler.js'

const app = express()
app.set('trust proxy', true)

// Middleware global
app.use(compression())
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: false, limit: '20mb' }))
app.use(express.text({ type: ['text/plain', 'text/*', 'application/octet-stream'], limit: '20mb' }))
app.use(cookieParser())
app.use(corsMiddleware)
app.use(securityMiddleware)
app.use(loggerMiddleware)

// Serve static files
app.use(express.static('public'))

// Routes
app.use('/auth', authRoutes)
app.use('/iclock', deviceRoutes)
app.use('/api', apiLimiter) // General API rate limit
app.use('/api', apiRoutes)
app.use('/api/activity-logs', activityLogLimiter) // Activity log polling limiter
app.use('/api/activity-logs', activityLogRoutes)
app.use('/api/pull', syncLimiter) // Pull data (operasi berat)
app.use('/api/pull', pullRoutes)
app.use('/api/pull-employee', syncLimiter) // Pull employee (operasi berat)
app.use('/api/pull-employee', pullEmployeeRoutes)
app.use('/api/sync', syncLimiter) // Sync (operasi berat)
app.use('/api/sync', syncRoutes)

// Health check endpoint komprehensif
app.get('/health', async (_req, res) => {
  const checks = {
    status: 'ok',
    service: 'GSI ADMS listener',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    checks: {}
  }

  // Check database connectivity
  try {
    const dbStart = Date.now()
    await pool.query('SELECT 1')
    checks.checks.database = {
      status: 'ok',
      latency_ms: Date.now() - dbStart
    }
  } catch (err) {
    checks.checks.database = { status: 'error', message: err.message }
    checks.status = 'degraded'
  }

  // Check raw directory (ensureRawDir already imported at top)
  try {
    await ensureRawDir()
    checks.checks.raw_dir = { status: 'ok' }
  } catch (err) {
    checks.checks.raw_dir = { status: 'error', message: err.message }
    checks.status = 'degraded'
  }

  const statusCode = checks.status === 'ok' ? 200 : 503
  res.status(statusCode).json(checks)
})

// Root endpoint (simple)
app.get('/', (_req, res) =>
  res.json({ status: 'OK', service: 'GSI ADMS listener', time: new Date().toISOString() })
)

// 404 handler for unknown routes
app.use(notFoundHandler)

// Global error handler
app.use(globalErrorHandler)

// ============================================================
// Graceful Shutdown
// ============================================================
let server

function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`)
  
  // Stop accepting new connections
  if (server) {
    server.close(() => {
      console.log('✅ HTTP server closed')
    })
  }

  // Close database pool
  pool.end().then(() => {
    console.log('✅ Database pool closed')
    process.exit(0)
  }).catch((err) => {
    console.error('❌ Error closing database pool:', err)
    process.exit(1)
  })

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown after timeout')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// ============================================================
// Inisialisasi dan startup
// ============================================================
;(async () => {
  try {
    await ensureSchema()
    await ensureRawDir()
    await cleanupOldRawFiles()
    startPullScheduler()

    // Setup cleanup interval
    setInterval(cleanupOldRawFiles, config.CLEANUP_INTERVAL_MS)

    server = app.listen(config.PORT, () => {
      console.log(`✅ GSI ADMS listener ready on port ${config.PORT}`)
      console.log(`🔗 Health check: http://localhost:${config.PORT}/health`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
})()

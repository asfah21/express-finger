// Entry point utama aplikasi
import express from 'express'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import { config } from './config/index.js'
import {
  corsMiddleware,
  securityMiddleware,
  loggerMiddleware,
  globalLimiter,
  authLimiter,
  apiLimiter,
  apiBurstLimiter,
  syncLimiter,
  syncDeviceLimiter,
  activityLogLimiter,
  csrfTokenProvider,
  csrfProtection,
  iclockLimiter,
  iclockDeviceLimiter,
  iclockIpGuard,
  kioskLiveLimiter,
  kioskLiveIpLimiter
} from './middleware/index.js'
import { deviceRoutes, apiRoutes, authRoutes, activityLogRoutes, pullRoutes, pullEmployeeRoutes, syncRoutes, templateSyncRoutes, templateManualRoutes, liveRoutes } from './routes/index.js'
import { globalErrorHandler, notFoundHandler } from './middleware/index.js'
import { ensureSchema, ensureRawDir, cleanupOldRawFiles, pool, cleanupExpiredSessions } from './utils/index.js'
import { startPullScheduler } from './utils/scheduler.js'
import { warmCache } from './utils/cache.js'
import { getSettingsData } from './controllers/settings.js'
import { getDevices } from './utils/database.js'
import { requirePageAuth } from './middleware/index.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'


const app = express()
// Trust proxy: dikendalikan sepenuhnya oleh config.TRUST_PROXY (lihat
// config/index.js). Default aman = false (req.ip = IP socket) sehingga klien
// tidak bisa memalsukan X-Forwarded-For untuk bypass rate-limit per-IP.
// Di belakang nginx/Caddy, set TRUST_PROXY=1 (atau IP proxy) agar req.ip =
// IP klien asli. CATATAN: express-rate-limit v8 menolak `trust proxy = true`.
app.set('trust proxy', config.TRUST_PROXY)

// Global catch-all rate limiter — dijalankan PALING AWAL (sebelum kompresi,
// parsing body, CSRF) sehingga banjir request ditolak dengan kerja minimal
// (mitigasi DoS) dan endpoint tanpa limiter khusus tetap terlindungi.
app.use(globalLimiter)

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'public')

// Middleware global
app.use(compression())
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: false, limit: '20mb' }))
// NOTE: express.text TIDAK dipasang global. Parser teks/octet-stream (20mb)
// hanya dibutuhkan protokol push perangkat ZK di /iclock, sehingga di-scope
// khusus ke rute itu (lihat bawah) — mencegah endpoint API lain menerima
// body octet-stream 20mb (mitigasi abuse/DoS, poin 6 hardening).
app.use(cookieParser())
app.use(corsMiddleware)
// CSRF: set cookie token dulu, lalu validasi request state-changing.
app.use(csrfTokenProvider)
app.use(csrfProtection)
app.use(securityMiddleware)
app.use(loggerMiddleware)

// Serve static files
// Keep live.html behind the login cookie. This route must be registered before
// express.static so direct navigation cannot bypass authentication.
app.get('/live.html', requirePageAuth, (_req, res) => {
  res.sendFile(path.join(publicDir, 'live.html'))
})
app.use(express.static(publicDir))

// `cam_live.html` is a static kiosk page, but it is also commonly opened
// directly after selecting an attendance type. Keep this explicit fallback
// so deployments with a static-file mount/configuration cannot send the
// request to the JSON 404 handler merely because the query string is present.
// Both kiosk camera pages are now behind login (like /live.html) so an
// unauthenticated device cannot reach the kiosk UI.
app.get('/cam_live.html', requirePageAuth, (_req, res) => {
  res.sendFile(path.join(publicDir, 'cam_live.html'))
})
app.get('/multi_live.html', requirePageAuth, (_req, res) => {
  res.sendFile(path.join(publicDir, 'multi_live.html'))
})

// Routes
// /auth: limiter umum + limiter khusus login/verify/user-management yang
// dipasang per-route di routes/auth.js.
app.use('/auth', authLimiter, authRoutes)
// /iclock: rate limit (per-IP + per-SN) + IP allowlist opsional + parser teks
// khusus protokol ZK, sebelum masuk ke controller perangkat (endpoint tanpa
// autentikasi).
app.use(
  '/iclock',
  iclockLimiter,
  iclockDeviceLimiter,
  iclockIpGuard,
  express.text({ type: ['text/plain', 'text/*', 'application/octet-stream'], limit: '20mb' }),
  deviceRoutes
)
app.use('/api', apiLimiter, apiBurstLimiter) // General API rate limit + cap burst
app.use('/api', apiRoutes)
app.use('/api/activity-logs', activityLogLimiter) // Activity log polling limiter
app.use('/api/activity-logs', activityLogRoutes)
app.use('/api/pull', syncLimiter, syncDeviceLimiter) // Pull data (operasi berat)
app.use('/api/pull', pullRoutes)
app.use('/api/pull-employee', syncLimiter, syncDeviceLimiter) // Pull employee (operasi berat)
app.use('/api/pull-employee', pullEmployeeRoutes)
app.use('/api/sync', syncLimiter, syncDeviceLimiter) // Sync (operasi berat)
app.use('/api/sync', syncRoutes)
app.use('/api/template-sync', syncLimiter, syncDeviceLimiter)
app.use('/api/template-sync', templateSyncRoutes)
app.use('/api/biometrics', syncLimiter, syncDeviceLimiter)
app.use('/api/biometrics', templateManualRoutes)
// Kiosk live (absensi wajah, mahal) — per-perangkat + per-IP, sebelum rute.
app.use('/api/live', kioskLiveIpLimiter, kioskLiveLimiter)
app.use('/api/live', liveRoutes)

// Health check endpoint komprehensif
app.get('/health', async (_req, res) => {
  // Jangan bocorkan pesan error internal (detail DB) ke client di production
  // (poin 9 hardening). Detail lengkap tetap tercatat di log server.
  const errDetail = process.env.NODE_ENV === 'production' ? 'unavailable' : (e) => e.message

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
    checks.checks.database = { status: 'error', message: errDetail(err) }
    checks.status = 'degraded'
  }

  // Check raw directory (ensureRawDir already imported at top)
  try {
    await ensureRawDir()
    checks.checks.raw_dir = { status: 'ok' }
  } catch (err) {
    checks.checks.raw_dir = { status: 'error', message: errDetail(err) }
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
  ; (async () => {
    try {
      await ensureSchema()
      await ensureRawDir()
      await cleanupOldRawFiles()
      startPullScheduler()

      // Setup cleanup intervals
      setInterval(cleanupOldRawFiles, config.CLEANUP_INTERVAL_MS)
      // Prune old/expired user sessions every hour
      setInterval(cleanupExpiredSessions, 60 * 60 * 1000)
      cleanupExpiredSessions()

      // Cache warming — pre-cache data statis dan overview
      warmCache({
        getSettingsData,
        getDevices,
      }).then(warmed => {
        console.log(`🔥 Cache warming complete: ${warmed.length} items cached`)
      }).catch(err => {
        console.warn(`⚠️ Cache warming partial: ${err.message}`)
      })

      server = app.listen(config.PORT, () => {
        console.log(`✅ GSI ADMS listener ready on port ${config.PORT}`)
        console.log(`🔗 Health check: http://localhost:${config.PORT}/health`)
      })

    } catch (error) {
      console.error('Failed to start server:', error)
      process.exit(1)
    }
  })()

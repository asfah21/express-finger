import jwt from 'jsonwebtoken'
import { config } from '../config/index.js'
import { getSettingsData } from '../controllers/settings.js'
import { sendError } from '../utils/response.js'

// Wajib: JWT_SECRET harus diset di environment variables.
// Tidak ada fallback hardcoded untuk keamanan maksimal.
const SECRET = process.env.JWT_SECRET
if (!SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is required!')
  console.error('   Set it in your .env file or docker-compose environment:')
  console.error('   JWT_SECRET=your-strong-random-secret-key')
  process.exit(1)
}

// Combined authentication middleware
// Allows either x-api-key OR a valid JWT token
export const requireApiKey = async (req, res, next) => {
  // Check for API Key first
  const key = req.headers['x-api-key']

  // Check dynamic key from settings
  const settings = await getSettingsData()

  if (key && (key === config.API_KEY || key === settings.api_key)) {
    return next()
  }

  // Check for JWT token (Cookie or Authorization header)
  const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1]

  if (!token) {
    return sendError(res, 'Authentication required (API Key or Token)', 401)
  }

  try {
    const decoded = jwt.verify(token, SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return sendError(res, 'Invalid or expired token', 401)
  }
}

// Middleware to require Admin privileges (can be chained after requireApiKey)
export const requireAdminPrivileges = (req, res, next) => {
  // If API key was used to authenticate (key is present), grant full access
  if (req.headers['x-api-key']) {
    return next()
  }
  
  // If JWT was used, ensure the user has the admin or superadmin role
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
    return next()
  }
  
  return sendError(res, 'Forbidden: Administrator privileges required', 403)
}

// Strictly JWT authentication middleware (for Dashboard internal routes if any)
export const requireAuth = (req, res, next) => {
  const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1]

  if (!token) {
    return sendError(res, 'Authentication required', 401)
  }

  try {
    const decoded = jwt.verify(token, SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return sendError(res, 'Invalid or expired token', 401)
  }
}

// Strictly Admin role middleware
export const requireAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
      next()
    } else {
      return sendError(res, 'Forbidden: Administrator privileges required', 403)
    }
  })
}

// Middleware to require Superadmin privileges
export const requireSuperAdminPrivileges = (req, res, next) => {
  // If API key was used to authenticate (key is present), grant full access
  if (req.headers['x-api-key']) {
    return next()
  }
  
  // If JWT was used, ensure the user has the superadmin role
  if (req.user && req.user.role === 'superadmin') {
    return next()
  }
  
  return sendError(res, 'Forbidden: Superadmin privileges required', 403)
}

// Middleware to optionally attach user info without blocking
export const optionalAuth = (req, res, next) => {
  const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1]
  
  if (token) {
    try {
      const decoded = jwt.verify(token, SECRET)
      req.user = decoded
    } catch (err) {
      // Token invalid, just continue without user
    }
  }
  
  next()
}

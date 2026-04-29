import jwt from 'jsonwebtoken'
import { config } from '../config/index.js'
import { getSettingsData } from '../controllers/settings.js'

const SECRET = process.env.JWT_SECRET || 'express-finger-secret-key-123'

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
    return res.status(401).json({ status: 'error', message: 'Authentication required (API Key or Token)' })
  }

  try {
    const decoded = jwt.verify(token, SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' })
  }
}

// Middleware to require Admin privileges (can be chained after requireApiKey)
export const requireAdminPrivileges = (req, res, next) => {
  // If API key was used to authenticate (key is present), grant full access
  if (req.headers['x-api-key']) {
    return next()
  }
  
  // If JWT was used, ensure the user has the admin role
  if (req.user && req.user.role === 'admin') {
    return next()
  }
  
  return res.status(403).json({ status: 'error', message: 'Forbidden: Administrator privileges required' })
}

// Strictly JWT authentication middleware (for Dashboard internal routes if any)
export const requireAuth = (req, res, next) => {
  const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1]

  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Authentication required' })
  }

  try {
    const decoded = jwt.verify(token, SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' })
  }
}

// Strictly Admin role middleware
export const requireAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      next()
    } else {
      return res.status(403).json({ status: 'error', message: 'Forbidden: Administrator privileges required' })
    }
  })
}
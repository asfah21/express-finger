import jwt from 'jsonwebtoken'
import { config } from '../config/index.js'

const SECRET = process.env.JWT_SECRET || 'express-finger-secret-key-123'

// Combined authentication middleware
// Allows either x-api-key OR a valid JWT token
export const requireApiKey = (req, res, next) => {
  // Check for API Key first
  const key = req.headers['x-api-key']
  if (key === config.API_KEY) {
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
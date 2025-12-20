import { config } from '../config/index.js'

// API key authentication middleware
export const requireApiKey = (req, res, next) => {
  const key = req.headers['x-api-key']
  if (key !== config.API_KEY) return res.status(401).json({ error: 'Invalid API key' })
  next()
}
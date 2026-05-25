/**
 * Global Error Handler Middleware
 * Catches unhandled errors and returns consistent JSON responses
 */
import { sendError } from '../utils/response.js'

/**
 * Global error handler
 * @param {Error} err - The error object
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Express next function
 */
export const globalErrorHandler = (err, req, res, next) => {
  console.error('❌ Unhandled error:', err)

  // Handle specific error types
  if (err.name === 'SyntaxError' && err.status === 400 && 'body' in err) {
    return sendError(res, 'Invalid JSON in request body', 400)
  }

  if (err.name === 'PayloadTooLargeError') {
    return sendError(res, 'Request body too large', 413)
  }

  if (err.code === 'ECONNREFUSED') {
    return sendError(res, 'Database connection refused', 503)
  }

  // Default: internal server error
  sendError(
    res,
    process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
    500
  )
}

/**
 * 404 Not Found handler
 * Catches requests to undefined routes
 */
export const notFoundHandler = (req, res) => {
  sendError(res, `Route ${req.method} ${req.originalUrl} not found`, 404)
}

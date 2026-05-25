/**
 * Standardized API response helpers
 * Ensures consistent response format across all endpoints
 */

/**
 * Send a success response
 * @param {object} res - Express response object
 * @param {*} data - Response data
 * @param {string} message - Optional success message
 * @param {number} statusCode - HTTP status code (default: 200)
 */
export function sendSuccess(res, data, message = '', statusCode = 200) {
    const response = { status: 'success' }
    if (message) response.message = message
    if (data !== undefined) response.data = data
    return res.status(statusCode).json(response)
}

/**
 * Send an error response
 * @param {object} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {*} details - Optional error details (not shown in production)
 */
export function sendError(res, message, statusCode = 500, details = null) {
    const response = { status: 'error', message }
    // Only include details in development mode
    if (details && process.env.NODE_ENV !== 'production') {
        response.details = details
    }
    return res.status(statusCode).json(response)
}

/**
 * Send a paginated success response
 * @param {object} res - Express response object
 * @param {Array} list - Data array
 * @param {number} total - Total items count
 * @param {number} limit - Items per page
 * @param {number} offset - Current offset
 */
export function sendPaginated(res, list, total, limit, offset) {
    return res.status(200).json({
        status: 'success',
        data: {
            total,
            limit,
            offset,
            has_more: offset + list.length < total,
            list
        }
    })
}

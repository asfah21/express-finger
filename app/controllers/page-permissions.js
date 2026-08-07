import { pool } from '../utils/database.js'
import { recordActivity } from './activity-log.js'
import { sendSuccess, sendError } from '../utils/response.js'

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
}

export const pagePermissionsController = {
    /**
     * Get all page permissions
     */
    async getAll(req, res) {
        try {
            const { rows } = await pool.query(
                'SELECT id, page_id, page_label, allowed_roles FROM page_permissions ORDER BY id ASC'
            )
            sendSuccess(res, rows)
        } catch (error) {
            sendError(res, error.message)
        }
    },

    /**
     * Update a single page permission
     */
    async update(req, res) {
        try {
            const { id } = req.params
            const { allowed_roles } = req.body

            if (!allowed_roles || !Array.isArray(allowed_roles) || allowed_roles.length === 0) {
                return sendError(res, 'allowed_roles must be a non-empty array', 400)
            }

            // Validate roles
            const validRoles = ['superadmin', 'admin', 'viewer', 'public']
            const invalidRoles = allowed_roles.filter(r => !validRoles.includes(r))
            if (invalidRoles.length > 0) {
                return sendError(res, `Invalid roles: ${invalidRoles.join(', ')}. Valid roles: ${validRoles.join(', ')}`, 400)
            }

            const { rows } = await pool.query(
                'UPDATE page_permissions SET allowed_roles = $1, updated_at = now() WHERE id = $2 RETURNING id, page_id, page_label, allowed_roles',
                [allowed_roles, id]
            )

            if (rows.length === 0) {
                return sendError(res, 'Page permission not found', 404)
            }

            const username = req.user?.username || 'api'
            const ip = getClientIp(req)
            await recordActivity({
                username, action: 'update_page_permission', category: 'settings',
                detail: `Updated page "${rows[0].page_label}" (${rows[0].page_id}) roles: ${allowed_roles.join(', ')}`,
                ip
            })

            sendSuccess(res, rows[0], 'Page permission updated')
        } catch (error) {
            sendError(res, error.message)
        }
    },

    /**
     * Get permissions for the current user (what pages they can access)
     * This is used by the frontend to dynamically show/hide pages
     */
    async getMyPermissions(req, res) {
        try {
            const userRole = req.user?.role || 'viewer'
            const { rows } = await pool.query(
                'SELECT page_id, page_label FROM page_permissions WHERE $1 = ANY(allowed_roles) ORDER BY id ASC',
                [userRole]
            )
            sendSuccess(res, rows)
        } catch (error) {
            sendError(res, error.message)
        }
    }
}

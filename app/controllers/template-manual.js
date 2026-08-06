import { pool } from '../utils/database.js'
import { templateStorage } from '../utils/template-storage.js'
import { toTemplateRecord } from '../utils/zklib-templates.js'
import { sendSuccess, sendError, sendPaginated } from '../utils/response.js'
import { recordActivity } from './activity-log.js'

const MAX_TEMPLATE_BYTES = 1024 * 1024
const TEMPLATE_TYPES = new Set(['fingerprint', 'face'])

const getClientIp = req => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''

function parseTemplateInput(body = {}) {
    const userId = String(body.userId ?? '').trim()
    const templateType = String(body.templateType ?? '').trim().toLowerCase()
    const templateIndex = Number(body.templateIndex)
    const base64 = String(body.base64 ?? '').trim().replace(/^data:.*?;base64,/, '')

    if (!userId || userId.length > 100) throw Object.assign(new Error('Valid userId is required'), { statusCode: 400 })
    if (!TEMPLATE_TYPES.has(templateType)) throw Object.assign(new Error('templateType must be fingerprint or face'), { statusCode: 400 })
    if (!Number.isInteger(templateIndex) || templateIndex < 0 || templateIndex > 255) {
        throw Object.assign(new Error('templateIndex must be an integer between 0 and 255'), { statusCode: 400 })
    }
    if (!base64) throw Object.assign(new Error('Template base64 data is required'), { statusCode: 400 })

    let data
    try { data = Buffer.from(base64, 'base64') } catch { throw Object.assign(new Error('Invalid base64 template data'), { statusCode: 400 }) }
    if (!data.length || data.length > MAX_TEMPLATE_BYTES) {
        throw Object.assign(new Error(`Template data must be between 1 byte and ${MAX_TEMPLATE_BYTES} bytes`), { statusCode: 400 })
    }
    return { userId, templateType, templateIndex, data }
}

function publicTemplate(template) {
    return {
        id: template.id,
        user_id: template.user_id,
        template_type: template.template_type,
        template_index: template.template_index,
        size: template.size,
        checksum: template.checksum,
        template_version: template.template_version,
        payload_format: template.payload_format,
        source_device_id: template.source_device_id,
        source_device_sn: template.source_device_sn,
        source_model: template.source_model,
        source_firmware: template.source_firmware,
        metadata: template.metadata,
        captured_at: template.captured_at,
        last_verified_at: template.last_verified_at,
        created_by: template.created_by,
        created_at: template.created_at,
        updated_at: template.updated_at
    }
}

export const templateManualController = {
    async listTemplates(req, res) {
        try {
            const userId = String(req.query.userId ?? '').trim()
            if (!userId) return sendError(res, 'userId is required', 400)

            const templates = await templateStorage.listTemplates({ userId })
            return sendSuccess(res, templates.map(publicTemplate))
        } catch (error) {
            return sendError(res, error.message, error.statusCode || 500)
        }
    },

    async saveTemplate(req, res) {
        try {
            const input = parseTemplateInput(req.body)
            const { rows: employees } = await pool.query('SELECT id, nama FROM employee WHERE user_id = $1 LIMIT 1', [input.userId])
            if (!employees.length) return sendError(res, 'Employee with this userId was not found', 404)

            const record = toTemplateRecord({ data: input.data }, {
                userId: input.userId,
                templateType: input.templateType,
                templateIndex: input.templateIndex
            })
            record.metadata = {
                ...record.metadata,
                source: 'manual-upload',
                originalFilename: String(req.body.originalFilename || '').slice(0, 255) || undefined
            }
            record.createdBy = req.user?.username || 'api'
            record.capturedAt = new Date()

            const saved = await templateStorage.saveTemplate(record)
            await recordActivity({
                username: req.user?.username || 'api',
                action: 'add_biometric_template',
                category: 'biometric',
                detail: `Stored ${input.templateType} template for employee ${input.userId}, index ${input.templateIndex}, size ${saved.size}, checksum ${saved.checksum}`,
                ip: getClientIp(req)
            })
            return sendSuccess(res, publicTemplate(saved), 'Biometric template saved', 201)
        } catch (error) {
            return sendError(res, error.message, error.statusCode || 500)
        }
    },

    async deleteTemplate(req, res) {
        try {
            const template = await templateStorage.invalidateTemplate(req.params.id)
            if (!template) return sendError(res, 'Template not found', 404)

            await recordActivity({
                username: req.user?.username || 'api',
                action: 'delete_biometric_template',
                category: 'biometric',
                detail: `Invalidated ${template.template_type} template for employee ${template.user_id}, index ${template.template_index}, checksum ${template.checksum}`,
                ip: getClientIp(req)
            })
            return sendSuccess(res, template, 'Biometric template deleted')
        } catch (error) {
            return sendError(res, error.message, error.statusCode || 500)
        }
    },

    async downloadTemplate(req, res) {
        try {
            const template = await templateStorage.getTemplate(req.params.id)
            if (!template) return sendError(res, 'Template not found', 404)
            return sendSuccess(res, {
                ...publicTemplate(template),
                base64: template.template_data.toString('base64')
            })
        } catch (error) {
            return sendError(res, error.message, error.statusCode || 500)
        }
    }
}

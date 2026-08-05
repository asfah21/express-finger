import crypto from 'node:crypto'
import { pool } from './database.js'

function toBuffer(data) {
    if (Buffer.isBuffer(data)) return data
    if (data instanceof Uint8Array) return Buffer.from(data)
    throw new TypeError('template_data must be a Buffer or Uint8Array')
}

export class TemplateStorage {
    constructor(db = pool) { this.db = db }

    async saveTemplate(template) {
        const data = toBuffer(template.templateData)
        const digest = template.checksum || crypto.createHash('sha256').update(data).digest('hex')
        const { rows } = await this.db.query(
            `INSERT INTO employee_templates (
        user_id, template_type, template_index, template_data, size, checksum,
        source_device_id, source_device_sn, template_version, payload_format,
        source_model, source_firmware, source_firmware_family, metadata,
        captured_at, last_verified_at, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (user_id, template_type, template_index, template_version, payload_format)
        WHERE valid = true
      DO UPDATE SET template_data = EXCLUDED.template_data, size = EXCLUDED.size,
        checksum = EXCLUDED.checksum, source_device_id = EXCLUDED.source_device_id,
        source_device_sn = EXCLUDED.source_device_sn, source_model = EXCLUDED.source_model,
        source_firmware = EXCLUDED.source_firmware, source_firmware_family = EXCLUDED.source_firmware_family,
        metadata = EXCLUDED.metadata, captured_at = EXCLUDED.captured_at,
        last_verified_at = EXCLUDED.last_verified_at, created_by = EXCLUDED.created_by, updated_at = now()
      RETURNING *`,
            [template.userId, template.templateType, template.templateIndex, data, data.length, digest,
            template.sourceDeviceId ?? null, template.sourceDeviceSn ?? null, template.templateVersion,
            template.payloadFormat, template.sourceModel ?? null, template.sourceFirmware ?? null,
            template.sourceFirmwareFamily ?? null, template.metadata ?? {}, template.capturedAt ?? null,
            template.lastVerifiedAt ?? null, template.createdBy ?? null]
        )
        return rows[0]
    }

    async getTemplate(id) {
        const { rows } = await this.db.query('SELECT * FROM employee_templates WHERE id = $1 AND valid = true', [id])
        return rows[0] || null
    }

    async listTemplates(filters = {}) {
        const values = []
        const clauses = ['valid = true']
        for (const [column, value] of [['user_id', filters.userId], ['source_device_id', filters.sourceDeviceId], ['template_type', filters.templateType]]) {
            if (value !== undefined && value !== null) { values.push(value); clauses.push(`${column} = $${values.length}`) }
        }
        const { rows } = await this.db.query(`SELECT * FROM employee_templates WHERE ${clauses.join(' AND ')} ORDER BY user_id, template_type, template_index`, values)
        return rows
    }
}

export const templateStorage = new TemplateStorage()

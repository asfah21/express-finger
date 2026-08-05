import { pullMasterTemplates, dryRunDeviceSync, reconcileTemplatesToDevice, syncAllTargets } from '../utils/template-sync.js'
import { pool } from '../utils/database.js'
import { sendSuccess, sendError } from '../utils/response.js'
import { recordActivity } from './activity-log.js'

const getClientIp = req => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
const requestOptions = req => {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    return { allowDelete: body.allowDelete === true, confirmDelete: body.confirmDelete === true, lockTimeoutMs: body.lockTimeoutMs, dryRun: body.dryRun }
}
const audit = (req, action, detail) => recordActivity({ username: req.user?.username || 'api', action, category: 'template_sync', detail, ip: getClientIp(req) })
const handle = (fn) => async (req, res) => { try { return sendSuccess(res, await fn(req), 'Template sync operation completed') } catch (error) { return sendError(res, error.message, error.statusCode || 500) } }

export const templateSyncController = {
    pullMaster: handle(async req => { const result = await pullMasterTemplates(); await audit(req, 'template_sync_pull_master', `Pulled ${result.count} templates from master device ${result.deviceId}`); return result }),
    dryRun: handle(async req => { const result = await dryRunDeviceSync(req.params.deviceId, requestOptions(req)); await audit(req, 'template_sync_dry_run', `Dry-run completed for device ${req.params.deviceId}`); return result }),
    push: handle(async req => { const result = await reconcileTemplatesToDevice(req.params.deviceId, requestOptions(req)); await audit(req, 'template_sync_push', `Push completed for device ${req.params.deviceId}`); return result }),
    pushAll: handle(async req => { const result = await syncAllTargets({ ...requestOptions(req), dryRun: false }); await audit(req, 'template_sync_push_all', `Push-all completed for ${result.results.length} target devices`); return result }),
    status: handle(async () => {
        const [{ rows: devices }, { rows: logs }] = await Promise.all([
            pool.query('SELECT id, name, ip, port, sn, model, firmware, is_active, is_template_master, status, last_sync FROM devices ORDER BY id'),
            pool.query('SELECT operation, status, device_id, source_device_id, template_type, action, error_code, metadata, actor, started_at, finished_at FROM template_sync_logs ORDER BY started_at DESC LIMIT 100')
        ])
        return { devices, recentLogs: logs }
    })
}

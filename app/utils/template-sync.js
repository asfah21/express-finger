import crypto from 'node:crypto'
import ZKLib from 'node-zklib'
import { pool } from './database.js'
import { templateStorage } from './template-storage.js'
import { withDeviceLock } from './device-lock.js'
import { getDeviceCapability } from './device-capability.js'
import { readFingerprintTemplates, readFaceTemplates, writeFingerprintTemplate, writeFaceTemplate, deleteTemplate, toTemplateRecord } from './zklib-templates.js'
import { disableRefreshEnable } from './zk-protocol.js'

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex')

function safeMetadata(value = {}) {
    const allowed = ['command', 'ack', 'replyId', 'responseSize', 'size', 'checksum', 'reason', 'status', 'evidenceId']
    return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key)))
}

async function logSync(entry, db = pool) {
    const metadata = safeMetadata(entry.metadata)
    await db.query(`INSERT INTO template_sync_logs
      (operation, status, device_id, source_device_id, user_id, template_type, template_index,
       before_checksum, after_checksum, template_version, payload_format, action, error_code,
       error_message, metadata, actor, started_at, finished_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [
        entry.operation, entry.status, entry.deviceId ?? null, entry.sourceDeviceId ?? null,
        entry.userId ?? null, entry.templateType ?? null, entry.templateIndex ?? null,
        entry.beforeChecksum ?? null, entry.afterChecksum ?? null, entry.templateVersion ?? null,
        entry.payloadFormat ?? null, entry.action ?? null, entry.errorCode ?? null,
        entry.errorMessage ?? null, metadata, entry.actor ?? 'system', entry.startedAt ?? new Date(), entry.finishedAt ?? new Date()
    ])
}

async function getDevice(deviceId) {
    const { rows } = await pool.query('SELECT * FROM devices WHERE id = $1', [deviceId])
    if (!rows[0]) throw Object.assign(new Error(`Device ${deviceId} not found`), { code: 'DEVICE_NOT_FOUND' })
    return rows[0]
}

function deviceInfo(device, info = {}) {
    return { model: info.model || device.model || device.name || '', firmware: info.firmware || device.firmware || 'UNKNOWN', serialNumber: info.serialNumber || device.sn }
}

async function readDeviceTemplates(device, options = {}) {
    const zk = new ZKLib(device.ip, Number(device.port || 4370), 15000, 5200 + Math.floor(Math.random() * 1000))
    try {
        await zk.createSocket()
        let info = {}
        try { info = await zk.getInfo() } catch { /* capability may come from the registry */ }
        const resolved = deviceInfo(device, info)
        const capability = options.capability || getDeviceCapability(resolved)
        const fingerprint = await readFingerprintTemplates({ zk, ...resolved }, { capability, allowProbeRequired: options.allowProbeRequired })
        const face = await readFaceTemplates({ zk, ...resolved }, { capability, allowProbeRequired: options.allowProbeRequired })
        return { zk, info: resolved, capability, fingerprint: fingerprint.templates, face: face.templates, evidence: { fingerprint: fingerprint.evidence, face: face.evidence } }
    } catch (error) {
        try { await zk.disconnect() } catch { /* preserve original error */ }
        throw error
    }
}

export async function pullMasterTemplates(options = {}) {
    const { rows } = await pool.query('SELECT * FROM devices WHERE is_template_master = true AND is_active = true LIMIT 1')
    const master = rows[0]
    if (!master) throw Object.assign(new Error('No active template master configured'), { code: 'MASTER_NOT_CONFIGURED' })
    const startedAt = new Date()
    const result = await readDeviceTemplates(master, options)
    const stored = []
    for (const [templateType, records] of [['fingerprint', result.fingerprint], ['face', result.face]]) {
        for (const record of records) {
            const template = toTemplateRecord(record, { userId: record.userId || String(record.uid), templateType, templateIndex: record.templateIndex })
            template.sourceDeviceId = master.id
            template.sourceDeviceSn = master.sn
            template.sourceModel = result.info.model
            template.sourceFirmware = result.info.firmware
            template.capturedAt = new Date()
            const existing = (await templateStorage.listTemplates({ userId: template.userId, templateType })).find(item => item.template_index === template.templateIndex && item.payload_format === template.payloadFormat)
            if (!existing || existing.checksum !== template.checksum) await templateStorage.saveTemplate(template)
            await logSync({ operation: 'pull', status: 'success', deviceId: master.id, sourceDeviceId: master.id, userId: template.userId, templateType, templateIndex: template.templateIndex, afterChecksum: template.checksum, templateVersion: template.templateVersion, payloadFormat: template.payloadFormat, action: existing?.checksum === template.checksum ? 'SKIP' : 'UPDATE', metadata: result.evidence[templateType], startedAt })
            stored.push({ ...template, templateData: undefined })
        }
    }
    try { await result.zk.disconnect() } catch { /* cleanup */ }
    return { success: true, deviceId: master.id, count: stored.length, templates: stored }
}

function planDiff(serverTemplates, deviceTemplates, capability, options = {}) {
    const current = new Map(deviceTemplates.map(item => [`${item.templateType}:${item.templateIndex}:${item.userId || item.uid}`, item]))
    const plan = []
    for (const template of serverTemplates) {
        const key = `${template.template_type}:${template.template_index}:${template.user_id}`
        const device = current.get(key)
        const capabilityEntry = capability[template.template_type === 'face' ? 'faceWrite' : 'fingerprintWrite']
        if (capabilityEntry.status !== 'SUPPORTED') {
            plan.push({ action: 'SKIP_INCOMPATIBLE', userId: template.user_id, templateType: template.template_type, templateIndex: template.template_index, checksum: template.checksum, size: template.size, payloadFormat: template.payload_format, reason: capabilityEntry.status })
        } else if (device && sha256(device.data) === template.checksum) {
            plan.push({ action: 'SKIP_UNCHANGED', userId: template.user_id, templateType: template.template_type, templateIndex: template.template_index, checksum: template.checksum, size: template.size, payloadFormat: template.payload_format })
        } else {
            plan.push({ action: device ? 'UPDATE' : 'ADD', userId: template.user_id, templateType: template.template_type, templateIndex: template.template_index, checksum: template.checksum, beforeChecksum: device ? sha256(device.data) : null, size: template.size, payloadFormat: template.payload_format, template })
        }
    }
    if (options.includeDeletes) {
        for (const device of deviceTemplates) if (!serverTemplates.some(item => item.user_id === (device.userId || String(device.uid)) && item.template_type === device.templateType && item.template_index === device.templateIndex)) plan.push({ action: 'OPTIONAL_DELETE', userId: device.userId || String(device.uid), templateType: device.templateType, templateIndex: device.templateIndex, reason: 'not-present-on-server' })
    }
    return plan
}

export async function dryRunDeviceSync(deviceId, options = {}) {
    const device = await getDevice(deviceId)
    const target = await readDeviceTemplates(device, options)
    const serverTemplates = await templateStorage.listTemplates()
    const plan = planDiff(serverTemplates, [...target.fingerprint.map(item => ({ ...item, templateType: 'fingerprint', userId: item.userId || String(item.uid) })), ...target.face.map(item => ({ ...item, templateType: 'face', userId: item.userId || String(item.uid) }))], target.capability, { includeDeletes: options.allowDelete === true })
    await target.zk.disconnect()
    for (const item of plan) await logSync({ operation: 'dry_run', status: 'success', deviceId, userId: item.userId, templateType: item.templateType, templateIndex: item.templateIndex, beforeChecksum: item.beforeChecksum, afterChecksum: item.checksum, payloadFormat: item.payloadFormat, action: item.action, metadata: { reason: item.reason, size: item.size } })
    return { deviceId, dryRun: true, plan: plan.map(({ template, ...item }) => item) }
}

export async function reconcileTemplatesToDevice(deviceId, options = {}) {
    return withDeviceLock(deviceId, async () => {
        const device = await getDevice(deviceId)
        const target = await readDeviceTemplates(device, options)
        const serverTemplates = await templateStorage.listTemplates()
        const deviceTemplates = [...target.fingerprint.map(item => ({ ...item, templateType: 'fingerprint', userId: item.userId || String(item.uid) })), ...target.face.map(item => ({ ...item, templateType: 'face', userId: item.userId || String(item.uid) }))]
        const plan = planDiff(serverTemplates, deviceTemplates, target.capability, { includeDeletes: options.allowDelete === true })
        const results = []
        await disableRefreshEnable(target.zk, {
            allowDisableFailure: false, run: async () => {
                for (const item of plan) {
                    try {
                        if (item.action === 'ADD' || item.action === 'UPDATE') {
                            const record = { uid: deviceTemplates.find(d => d.userId === item.userId)?.uid || 0, templateIndex: item.templateIndex, data: item.template.template_data }
                            const evidence = item.template.template_type === 'face' ? await writeFaceTemplate(target.zk, record, { capability: target.capability, deviceInfo: target.info }) : await writeFingerprintTemplate(target.zk, record, { capability: target.capability, deviceInfo: target.info })
                            results.push({ ...item, status: 'success', evidence: evidence.evidence })
                        } else if (item.action === 'OPTIONAL_DELETE' && options.allowDelete === true && options.confirmDelete === true) {
                            const record = deviceTemplates.find(d => d.userId === item.userId && d.templateType === item.templateType && d.templateIndex === item.templateIndex)
                            const evidence = await deleteTemplate(target.zk, record, { allowDelete: true })
                            results.push({ ...item, action: 'DELETE', status: 'success', evidence: evidence.evidence })
                        } else results.push({ ...item, status: 'skipped' })
                    } catch (error) { results.push({ ...item, status: 'error', errorCode: error.code || 'TEMPLATE_SYNC_ERROR', reason: error.message }) }
                }
            }
        })
        try { await target.zk.disconnect() } catch { /* cleanup */ }
        for (const result of results) await logSync({ operation: result.status === 'error' ? 'error' : result.action === 'DELETE' ? 'delete' : 'write', status: result.status, deviceId, userId: result.userId, templateType: result.templateType, templateIndex: result.templateIndex, beforeChecksum: result.beforeChecksum, afterChecksum: result.checksum, payloadFormat: result.payloadFormat, action: result.action, errorCode: result.errorCode, errorMessage: result.reason, metadata: result.evidence })
        return { success: results.every(item => item.status !== 'error'), deviceId, results }
    }, { lockType: 'template-sync', timeoutMs: options.lockTimeoutMs || 120000 })
}

export async function syncAllTargets(options = {}) {
    const { rows } = await pool.query('SELECT id FROM devices WHERE is_active = true AND is_template_master = false ORDER BY id')
    const results = []
    for (const device of rows) {
        try { results.push(await (options.dryRun === false ? reconcileTemplatesToDevice(device.id, options) : dryRunDeviceSync(device.id, options))) }
        catch (error) { results.push({ success: false, deviceId: device.id, errorCode: error.code || 'TEMPLATE_SYNC_ERROR', error: error.message }) }
    }
    return { success: results.every(item => item.success !== false), results }
}


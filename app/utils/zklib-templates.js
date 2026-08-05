import crypto from 'node:crypto'
import { createZKClient, readBuffered, execute, ZK_COMMANDS } from './zk-protocol.js'
import { getDeviceCapability, capabilityRegistry } from './device-capability.js'

export const TEMPLATE_VERSION = 1
export const TEMPLATE_FORMATS = Object.freeze({ fingerprint: 'zk-raw-fingerprint-v1', face: 'zk-raw-face-v1' })

const fingerprintRequest = Buffer.from([0x01, 0x07, 0x00, 0x02, 0, 0, 0, 0, 0, 0, 0])
const faceRequest = Buffer.from([0x01, 0x56, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0])

function checksum(data) { return crypto.createHash('sha256').update(data).digest('hex') }
function evidence(type, data, extra = {}) {
    return { templateType: type, size: data.length, checksum: checksum(data), ...extra }
}

export function parseFingerprintTemplates(payload) {
    const data = Buffer.from(payload)
    const records = []
    let offset = data.length >= 4 ? 4 : 0
    while (offset + 6 <= data.length) {
        const size = data.readUInt16LE(offset)
        const uid = data.readUInt16LE(offset + 2)
        const templateIndex = data.readUInt8(offset + 4)
        const valid = data.readUInt8(offset + 5)
        if (size < 6 || offset + size > data.length) break
        const templateData = data.subarray(offset + 6, offset + size)
        records.push({ uid, templateIndex, valid: Boolean(valid), data: Buffer.from(templateData), evidence: evidence('fingerprint', templateData, { recordSize: size }) })
        offset += size
    }
    return records
}

export function parseFaceTemplates(payload) {
    const data = Buffer.from(payload)
    const records = []
    let offset = data.length >= 4 ? 4 : 0
    while (offset + 6 <= data.length) {
        const size = data.readUInt16LE(offset)
        const templateIndex = data.readUInt16LE(offset + 2)
        const valid = data.readUInt8(offset + 4)
        if (size < 6 || offset + size > data.length) break
        const templateData = data.subarray(offset + 5, offset + size)
        records.push({ templateIndex, valid: Boolean(valid), data: Buffer.from(templateData), evidence: evidence('face', templateData, { recordSize: size }) })
        offset += size
    }
    return records
}

export function encodeFingerprintTemplate(record) {
    const data = Buffer.from(record.data)
    const buffer = Buffer.alloc(6 + data.length)
    buffer.writeUInt16LE(buffer.length, 0)
    buffer.writeUInt16LE(Number(record.uid || 0), 2)
    buffer.writeUInt8(Number(record.templateIndex || 0), 4)
    buffer.writeUInt8(record.valid === false ? 0 : 1, 5)
    data.copy(buffer, 6)
    return buffer
}

export function encodeFaceTemplate(record) {
    const data = Buffer.from(record.data)
    const buffer = Buffer.alloc(5 + data.length)
    buffer.writeUInt16LE(buffer.length, 0)
    buffer.writeUInt16LE(Number(record.templateIndex || 0), 2)
    buffer.writeUInt8(record.valid === false ? 0 : 1, 4)
    data.copy(buffer, 5)
    return buffer
}

async function withClient(target, operation) {
    const zk = target.zk || createZKClient(target.ip, target.port)
    const owned = !target.zk
    try {
        if (owned) await zk.createSocket()
        return await operation(zk)
    } finally {
        if (owned) {
            try { await zk.disconnect() } catch { /* preserve operation result */ }
        }
    }
}

export async function readFingerprintTemplates(target, options = {}) {
    return withClient(target, async zk => {
        const capability = options.capability || getDeviceCapability(options.deviceInfo || target)
        if (capability.fingerprintRead.status !== 'SUPPORTED' && !options.allowProbeRequired) {
            return { templates: [], evidence: { status: capability.fingerprintRead.status, reason: 'capability-not-supported' } }
        }
        const result = await readBuffered(zk, options.request || fingerprintRequest, options)
        const templates = parseFingerprintTemplates(result.data)
        return { templates, evidence: { ...result.evidence, status: capability.fingerprintRead.status, command: capability.fingerprintRead.command, count: templates.length } }
    })
}

export async function readFaceTemplates(target, options = {}) {
    return withClient(target, async zk => {
        const capability = options.capability || getDeviceCapability(options.deviceInfo || target)
        if (capability.faceRead.status !== 'SUPPORTED' && !options.allowProbeRequired) {
            return { templates: [], evidence: { status: capability.faceRead.status, reason: 'capability-not-supported' } }
        }
        const result = await readBuffered(zk, options.request || faceRequest, options)
        const templates = parseFaceTemplates(result.data)
        return { templates, evidence: { ...result.evidence, status: capability.faceRead.status, command: capability.faceRead.command, count: templates.length } }
    })
}

export async function writeFingerprintTemplate(zk, record, options = {}) {
    const capability = options.capability || getDeviceCapability(options.deviceInfo || {})
    capabilityRegistry.assertWritable(capability, 'fingerprint')
    const payload = encodeFingerprintTemplate(record)
    const result = await execute(zk, ZK_COMMANDS.CMD_USERTEMP_WRQ, payload, { requireAck: true })
    return { success: true, evidence: { ...evidence('fingerprint', record.data), ...result.evidence, status: 'SUPPORTED' } }
}

export async function writeFaceTemplate(zk, record, options = {}) {
    const capability = options.capability || getDeviceCapability(options.deviceInfo || {})
    capabilityRegistry.assertWritable(capability, 'face')
    const payload = encodeFaceTemplate(record)
    const result = await execute(zk, ZK_COMMANDS.CMD_FACE_TMP_WRQ, payload, { requireAck: true })
    return { success: true, evidence: { ...evidence('face', record.data), ...result.evidence, status: 'SUPPORTED' } }
}

export async function deleteTemplate(zk, record, options = {}) {
    if (options.allowDelete !== true) throw Object.assign(new Error('Template delete requires allowDelete=true'), { code: 'DELETE_NOT_ALLOWED' })
    const payload = Buffer.alloc(4)
    payload.writeUInt16LE(Number(record.uid || 0), 0)
    payload.writeUInt8(Number(record.templateIndex || 0), 2)
    payload.writeUInt8(record.templateType === 'face' ? 1 : 0, 3)
    const result = await execute(zk, ZK_COMMANDS.CMD_DELETE_USERTEMP, payload, { requireAck: true })
    return { success: true, evidence: { ...result.evidence, templateType: record.templateType, templateIndex: record.templateIndex } }
}

export function toTemplateRecord(record, metadata = {}) {
    const data = Buffer.from(record.data || record.templateData)
    const templateType = metadata.templateType || record.templateType || 'fingerprint'
    return {
        userId: String(metadata.userId ?? record.userId ?? ''),
        templateType,
        templateIndex: Number(metadata.templateIndex ?? record.templateIndex ?? 0),
        templateData: data,
        checksum: checksum(data),
        size: data.length,
        templateVersion: TEMPLATE_VERSION,
        payloadFormat: TEMPLATE_FORMATS[templateType],
        metadata: { encoding: 'BYTEA', checksumAlgorithm: 'sha256', normalization: 'none' }
    }
}


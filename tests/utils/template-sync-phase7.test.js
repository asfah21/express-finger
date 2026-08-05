import { describe, expect, it } from 'vitest'
import {
    encodeFaceTemplate,
    encodeFingerprintTemplate,
    parseFaceTemplates,
    parseFingerprintTemplates,
    toTemplateRecord
} from '../../app/utils/zklib-templates.js'
import { CAPABILITY_STATUS, DeviceCapabilityRegistry } from '../../app/utils/device-capability.js'

describe('template protocol fixtures', () => {
    it('round-trips fingerprint records and preserves metadata', () => {
        const payload = Buffer.concat([Buffer.alloc(4), encodeFingerprintTemplate({ uid: 42, templateIndex: 2, valid: true, data: Buffer.from([1, 2, 3]) })])
        const [record] = parseFingerprintTemplates(payload)
        expect(record).toMatchObject({ uid: 42, templateIndex: 2, valid: true })
        expect(record.data.equals(Buffer.from([1, 2, 3]))).toBe(true)
        expect(record.evidence.checksum).toHaveLength(64)
    })

    it('round-trips face records', () => {
        const payload = Buffer.concat([Buffer.alloc(4), encodeFaceTemplate({ templateIndex: 1, valid: true, data: Buffer.from([9, 8]) })])
        const [record] = parseFaceTemplates(payload)
        expect(record).toMatchObject({ templateIndex: 1, valid: true })
        expect([...record.data]).toEqual([9, 8])
    })

    it('creates checksum, version, and explicit payload format without raw log metadata', () => {
        const record = toTemplateRecord({ data: Buffer.from([1, 2]), templateIndex: 0 }, { userId: 'u1', templateType: 'fingerprint' })
        expect(record).toMatchObject({ userId: 'u1', templateVersion: 1, payloadFormat: 'zk-raw-fingerprint-v1', size: 2 })
        expect(record.checksum).toHaveLength(64)
    })
})

describe('capability selection', () => {
    it('defaults unknown devices to probe required and blocks writes', () => {
        const registry = new DeviceCapabilityRegistry([])
        const capability = registry.resolve({ model: 'unknown-device', firmware: '1.0' })
        expect(capability.fingerprintWrite.status).toBe(CAPABILITY_STATUS.PROBE_REQUIRED)
        expect(() => registry.assertWritable(capability, 'fingerprint')).toThrow(/not verified/)
    })

    it('accepts only explicitly supported write capability', () => {
        const registry = new DeviceCapabilityRegistry([])
        const capability = registry.register({ model: 'tested', firmware: '1', fingerprintWrite: { status: CAPABILITY_STATUS.SUPPORTED } })
        expect(registry.assertWritable(capability, 'fingerprint').status).toBe(CAPABILITY_STATUS.SUPPORTED)
    })
})

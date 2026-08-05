const VALID_STATUSES = new Set(['SUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED_RAW_ZK', 'PROBE_REQUIRED', 'ERROR'])

export const CAPABILITY_STATUS = Object.freeze({
    SUPPORTED: 'SUPPORTED',
    UNSUPPORTED: 'UNSUPPORTED',
    UNSUPPORTED_RAW_ZK: 'UNSUPPORTED_RAW_ZK',
    PROBE_REQUIRED: 'PROBE_REQUIRED',
    ERROR: 'ERROR'
})

const UNKNOWN = () => ({ status: CAPABILITY_STATUS.PROBE_REQUIRED, command: null, payloadFormat: null, chunking: 'unknown' })

const BUILT_IN = [
    {
        model: 'Solution X105', firmware: 'UNKNOWN',
        fingerprintRead: { ...UNKNOWN(), command: 'readWithBuffer(table=2)' },
        fingerprintWrite: { ...UNKNOWN(), command: 'CMD_USERTEMP_WRQ(10)' },
        faceRead: UNKNOWN(), faceWrite: UNKNOWN()
    },
    {
        model: 'Solution X606-S', firmware: 'UNKNOWN',
        fingerprintRead: UNKNOWN(), fingerprintWrite: UNKNOWN(),
        faceRead: { ...UNKNOWN(), command: 'CMD_FACE_TMP_RRQ(86)|CMD_FACE_TMP_RRQ_ALL(88)' },
        faceWrite: { ...UNKNOWN(), command: 'CMD_FACE_TMP_WRQ(85)|CMD_FACE_TMP_WRQ_ALL(89)' }
    }
]

function normalize(entry = {}) {
    const result = { ...entry }
    for (const key of ['fingerprintRead', 'fingerprintWrite', 'faceRead', 'faceWrite']) {
        result[key] = { ...UNKNOWN(), ...(entry[key] || {}) }
        if (!VALID_STATUSES.has(result[key].status)) result[key].status = CAPABILITY_STATUS.ERROR
    }
    return result
}

export class DeviceCapabilityRegistry {
    constructor(entries = BUILT_IN) { this.entries = entries.map(normalize) }

    register(entry) {
        const normalized = normalize(entry)
        this.entries = this.entries.filter(item => !(item.model === normalized.model && item.firmware === normalized.firmware && (item.serialNumber || null) === (normalized.serialNumber || null)))
        this.entries.push(normalized)
        return normalized
    }

    resolve(info = {}) {
        const model = String(info.model || '').trim()
        const firmware = String(info.firmware || 'UNKNOWN').trim()
        const serialNumber = info.serialNumber || null
        const exact = this.entries.find(item => item.model === model && item.firmware === firmware && (!item.serialNumber || item.serialNumber === serialNumber))
        if (exact) return { ...exact, matchedBy: 'model+firmware' }
        const modelUnknown = this.entries.find(item => item.model === model && item.firmware === 'UNKNOWN' && (!item.serialNumber || item.serialNumber === serialNumber))
        if (modelUnknown) return { ...modelUnknown, matchedBy: 'model+unknown-firmware' }
        return normalize({ model, firmware, serialNumber, fingerprintRead: UNKNOWN(), fingerprintWrite: UNKNOWN(), faceRead: UNKNOWN(), faceWrite: UNKNOWN(), matchedBy: 'default-deny' })
    }

    assertWritable(capability, templateType) {
        const key = templateType === 'face' ? 'faceWrite' : 'fingerprintWrite'
        const selected = capability?.[key]
        if (!selected || selected.status !== CAPABILITY_STATUS.SUPPORTED) {
            throw Object.assign(new Error(`${templateType} write capability is not verified`), { code: selected?.status || CAPABILITY_STATUS.PROBE_REQUIRED })
        }
        return selected
    }
}

export const capabilityRegistry = new DeviceCapabilityRegistry()
export const getDeviceCapability = info => capabilityRegistry.resolve(info)


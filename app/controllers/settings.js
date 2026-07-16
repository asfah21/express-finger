import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { recordActivity } from './activity-log.js'
import { sendSuccess, sendError } from '../utils/response.js'
import { getCache, setCache, delCache, CACHE_KEYS, TTL } from '../utils/cache.js'

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const settingsPath = path.join(__dirname, '../config/user_settings.json')

// ============================================================
// API Key Encryption / Decryption
// Menggunakan AES-256-GCM dengan key derivasi dari JWT_SECRET
// ============================================================
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32 // 256 bit
const IV_LENGTH = 16  // 128 bit
const TAG_LENGTH = 16 // 128 bit

function getEncryptionKey() {
    const secret = process.env.JWT_SECRET
    if (!secret) {
        throw new Error('JWT_SECRET is required for API key encryption')
    }
    // Derive a 256-bit key from JWT_SECRET using SHA256
    return crypto.createHash('sha256').update(secret).digest()
}

function encryptApiKey(plaintext) {
    if (!plaintext) return ''
    const key = getEncryptionKey()
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const authTag = cipher.getAuthTag().toString('hex')
    
    // Format: iv:authTag:ciphertext (all hex)
    return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

function decryptApiKey(encrypted) {
    if (!encrypted) return ''
    try {
        const key = getEncryptionKey()
        const parts = encrypted.split(':')
        if (parts.length !== 3) return encrypted // Not encrypted, return as-is
        
        const iv = Buffer.from(parts[0], 'hex')
        const authTag = Buffer.from(parts[1], 'hex')
        const ciphertext = parts[2]
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
        decipher.setAuthTag(authTag)
        
        let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
        decrypted += decipher.final('utf8')
        return decrypted
    } catch (err) {
        console.error('❌ Failed to decrypt API key:', err.message)
        return ''
    }
}

const defaultSettings = {
    late_tolerance_mins: 5,
    cleanup_age_days: 30,
    api_key: "",
    rule_in_out: {
        "day_checkin": ["05:00", "10:00"],
        "night_checkin": ["17:00", "22:00"],
        "day_checkout": ["17:00", "20:00"],
        "night_checkout": ["23:00", "08:00"]
    },
    types: {
        "0": "Masuk",
        "1": "Pulang",
        "2": "Break Out",
        "3": "Break In",
        "4": "Lembur Masuk",
        "5": "Lembur Keluar"
    },
    shift_types: {
        "S75": { "label": "Staff 07-17", "start": "07:00", "end": "17:00" },
        "S77": { "label": "Staff 07-19", "start": "07:00", "end": "19:00" },
        "N66": { "label": "Non-Staff 6-6 (2 Shift)", "shifts": [["06:00", "18:00"], ["18:00", "06:00"]] },
        "N77": { "label": "Non-Staff 7-7 (2 Shift)", "shifts": [["07:00", "19:00"], ["19:00", "07:00"]] },
        "N88": { "label": "Non-Staff 8-8 (2 Shift)", "shifts": [["08:00", "20:00"], ["20:00", "08:00"]] },
        "N99": { "label": "Non-Staff 9-9 (2 Shift)", "shifts": [["09:00", "21:00"], ["21:00", "09:00"]] }
    },
    remarks_config: {
        "late": "Terlambat {diff} menit",
        "early_arrival": "Anomali (Terlalu Awal)",
        "overtime_check": "Anomali (Lembur?)",
        "early_departure": "Pulang Cepat",
        "duplicate": "Duplikat Absensi",
        "anomaly_masuk": "Anomali / Masuk",
        "anomaly_pulang": "Anomali / Pulang"
    },
    auto_sync_employee_enabled: false,
    auto_sync_employee_interval_minutes: 30,
    auto_sync_employee_device_id: null
}

export async function getSettingsData() {
    try {
        const data = await readFile(settingsPath, 'utf8')
        const settings = JSON.parse(data)
        // Decrypt api_key when reading for internal use (auth middleware)
        if (settings.api_key && settings.api_key.includes(':')) {
            settings.api_key = decryptApiKey(settings.api_key)
        }
        // Merge remarks_config with defaults to ensure all keys exist
        // This handles the case where the saved file has an older format
        // missing newer remark keys like anomaly_masuk, anomaly_pulang
        if (settings.remarks_config && defaultSettings.remarks_config) {
            settings.remarks_config = {
                ...defaultSettings.remarks_config,
                ...settings.remarks_config
            }
        }
        // Ensure auto-sync keys exist in older saved settings
        if (settings.auto_sync_employee_enabled === undefined) {
            settings.auto_sync_employee_enabled = defaultSettings.auto_sync_employee_enabled
        }
        if (settings.auto_sync_employee_interval_minutes === undefined) {
            settings.auto_sync_employee_interval_minutes = defaultSettings.auto_sync_employee_interval_minutes
        }
        return settings
    } catch (error) {
        // Jika file belum ada, buat baru dengan default settings
        await writeFile(settingsPath, JSON.stringify(defaultSettings, null, 2))
        return defaultSettings
    }
}


// Validasi tipe data untuk setiap field settings yang diizinkan
const ALLOWED_KEYS = new Set([
    'api_key', 'late_tolerance_mins', 'cleanup_age_days',
    'types', 'shift_types', 'remarks_config', 'rule_in_out',
    'auto_sync_employee_enabled', 'auto_sync_employee_interval_minutes',
    'auto_sync_employee_device_id'
])

const FIELD_VALIDATORS = {
    api_key: (val) => typeof val === 'string',
    late_tolerance_mins: (val) => typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 999,
    cleanup_age_days: (val) => typeof val === 'number' && Number.isInteger(val) && val >= 1 && val <= 365,
    types: (val) => typeof val === 'object' && val !== null && !Array.isArray(val),
    shift_types: (val) => typeof val === 'object' && val !== null && !Array.isArray(val),
    remarks_config: (val) => typeof val === 'object' && val !== null && !Array.isArray(val),
    rule_in_out: (val) => typeof val === 'object' && val !== null && !Array.isArray(val),
    auto_sync_employee_enabled: (val) => typeof val === 'boolean',
    auto_sync_employee_interval_minutes: (val) => typeof val === 'number' && Number.isInteger(val) && val >= 5 && val <= 1440,
    auto_sync_employee_device_id: (val) => val === null || (typeof val === 'number' && Number.isInteger(val) && val > 0)
}

export const settingsController = {
    async getSettings(req, res) {
        try {
            // Cek cache
            const cached = getCache(CACHE_KEYS.SETTINGS)
            if (cached) {
                return sendSuccess(res, cached)
            }

            const settings = await getSettingsData()
            // For the frontend, send the api_key in plaintext so user can see/edit it
            // The encryption happens only when saving

            // Simpan ke cache
            setCache(CACHE_KEYS.SETTINGS, settings, TTL.VERY_LONG)

            sendSuccess(res, settings)
        } catch (error) {
            sendError(res, error.message)
        }
    },

    async updateSettings(req, res) {
        try {
            const currentSettings = await getSettingsData()

            // Hapus cache settings karena ada perubahan
            delCache(CACHE_KEYS.SETTINGS)
            const body = req.body || {}

            // Validasi: hanya field yang diizinkan yang bisa diubah
            const invalidKeys = Object.keys(body).filter(k => !ALLOWED_KEYS.has(k))
            if (invalidKeys.length > 0) {
                return sendError(res, `Unknown settings fields: ${invalidKeys.join(', ')}`, 400)
            }

            // Validasi tipe data setiap field
            for (const [key, value] of Object.entries(body)) {
                const validator = FIELD_VALIDATORS[key]
                if (validator && !validator(value)) {
                    return sendError(res, `Invalid value type for "${key}"`, 400)
                }
            }

            // Encrypt api_key before saving to file
            const bodyToSave = { ...body }
            if (bodyToSave.api_key) {
                bodyToSave.api_key = encryptApiKey(bodyToSave.api_key)
            } else if (bodyToSave.api_key === '') {
                bodyToSave.api_key = '' // Allow clearing the API key
            }

            const newSettings = { ...currentSettings, ...bodyToSave }

            // Tulis ulang file settings
            await writeFile(settingsPath, JSON.stringify(newSettings, null, 2))

            const username = req.user?.username || 'api'
            const ip = getClientIp(req)
            
            // Audit trail detail: catat perubahan spesifik
            const changes = []
            for (const key of Object.keys(body)) {
                const oldVal = currentSettings[key]
                const newVal = body[key]
                
                // Sembunyikan nilai sensitif di log
                if (key === 'api_key') {
                    const oldHidden = oldVal ? oldVal.substring(0, 4) + '****' : '(empty)'
                    const newHidden = newVal ? newVal.substring(0, 4) + '****' : '(empty)'
                    changes.push(`api_key: ${oldHidden} → ${newHidden}`)
                } else if (typeof oldVal === 'object' || typeof newVal === 'object') {
                    changes.push(`${key}: updated`)
                } else {
                    changes.push(`${key}: "${oldVal}" → "${newVal}"`)
                }
            }
            
            await recordActivity({
                username, action: 'update_settings', category: 'settings',
                detail: `Settings updated: ${changes.join('; ')}`,
                ip
            })

            // Return settings with decrypted api_key for the frontend
            const responseSettings = { ...newSettings }
            if (responseSettings.api_key) {
                responseSettings.api_key = decryptApiKey(responseSettings.api_key)
            }
            sendSuccess(res, responseSettings, 'Settings updated successfully')
        } catch (error) {
            sendError(res, error.message)
        }
    }
}
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { recordActivity } from './activity-log.js'
import { sendSuccess, sendError } from '../utils/response.js'

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const settingsPath = path.join(__dirname, '../config/user_settings.json')

const defaultSettings = {
    late_tolerance_mins: 5,
    cleanup_age_days: 30,
    api_key: "",
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
        "duplicate": "Duplikat Absensi"
    }
}

export async function getSettingsData() {
    try {
        const data = await readFile(settingsPath, 'utf8')
        return JSON.parse(data)
    } catch (error) {
        // Jika file belum ada, buat baru dengan default settings
        await writeFile(settingsPath, JSON.stringify(defaultSettings, null, 2))
        return defaultSettings
    }
}

export const settingsController = {
    async getSettings(req, res) {
        try {
            const settings = await getSettingsData()
            sendSuccess(res, settings)
        } catch (error) {
            sendError(res, error.message)
        }
    },

    async updateSettings(req, res) {
        try {
            const currentSettings = await getSettingsData()
            const newSettings = { ...currentSettings, ...req.body }

            // Tulis ulang file settings
            await writeFile(settingsPath, JSON.stringify(newSettings, null, 2))

            const username = req.user?.username || 'api'
            const ip = getClientIp(req)
            
            // Audit trail detail: catat perubahan spesifik (kecuali password)
            const changes = []
            for (const key of Object.keys(req.body)) {
                const oldVal = currentSettings[key]
                const newVal = req.body[key]
                
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

            sendSuccess(res, newSettings, 'Settings updated successfully')
        } catch (error) {
            sendError(res, error.message)
        }
    }
}

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const settingsPath = path.join(__dirname, '../config/user_settings.json')

const defaultSettings = {
    types: {
        "0": "Masuk",
        "1": "Pulang",
        "2": "Break Out",
        "3": "Break In",
        "4": "Lembur Masuk",
        "5": "Lembur Keluar"
    },
    devices: {}
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
            res.json({ status: 'success', data: settings })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async updateSettings(req, res) {
        try {
            const currentSettings = await getSettingsData()
            const newSettings = { ...currentSettings, ...req.body }

            // Tulis ulang file settings
            await writeFile(settingsPath, JSON.stringify(newSettings, null, 2))
            res.json({ status: 'success', message: 'Settings updated successfully', data: newSettings })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    }
}

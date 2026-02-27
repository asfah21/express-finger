import { pullDeviceLogs } from '../utils/zklib.js'
import { pool } from '../utils/database.js'

export const syncController = {
    /**
     * Manual sync for a specific device by IP or SN
     */
    async syncDevice(req, res) {
        const { ip, sn, port = 4370 } = req.body || req.query

        if (!ip && !sn) {
            return res.status(400).json({ error: 'IP or SN is required' })
        }

        try {
            let targetIp = ip
            let targetPort = port

            // If SN is provided, lookup the IP from devices table
            if (!ip && sn) {
                const { rows } = await pool.query('SELECT ip, port FROM devices WHERE sn = $1', [sn])
                if (rows.length === 0) {
                    return res.status(404).json({ error: `Device with SN ${sn} not found in registry` })
                }
                targetIp = rows[0].ip
                targetPort = rows[0].port || 4370
            }

            console.log(`🚀 Starting manual PULL sync for ${targetIp}...`)
            const result = await pullDeviceLogs(targetIp, targetPort)

            // Update last sync time
            await pool.query('UPDATE devices SET last_sync = now(), sn = $1 WHERE ip = $2', [result.sn, targetIp])

            res.json({
                message: 'Sync completed successfully',
                ...result
            })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    },

    /**
     * Sync all active devices in registry
     */
    async syncAll(req, res) {
        try {
            const { rows: devices } = await pool.query('SELECT ip, port, sn FROM devices WHERE is_active = true')

            if (devices.length === 0) {
                return res.json({ message: 'No active devices to sync', results: [] })
            }

            const results = []
            for (const dev of devices) {
                try {
                    const res = await pullDeviceLogs(dev.ip, dev.port || 4370)
                    await pool.query('UPDATE devices SET last_sync = now(), sn = $1 WHERE ip = $2', [res.sn, dev.ip])
                    results.push({ ip: dev.ip, success: true, ...res })
                } catch (err) {
                    results.push({ ip: dev.ip, success: false, error: err.message })
                }
            }

            res.json({
                message: 'Sync process finished',
                results
            })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    }
}

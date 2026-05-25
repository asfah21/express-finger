import { pullDeviceLogs } from '../utils/zklib.js'
import { pool } from '../utils/database.js'
import { recordActivity } from './activity-log.js'
import { sendSuccess, sendError } from '../utils/response.js'
import { delCacheByPatterns, CACHE_PATTERNS } from '../utils/cache.js'


function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
}

export const syncController = {
    /**
     * Manual sync for a specific device by IP or SN
     */
    async syncDevice(req, res) {
        const { ip, sn, port = 4370 } = req.body || req.query

        if (!ip && !sn) {
            return sendError(res, 'IP or SN is required', 400)
        }

        try {
            let targetIp = ip
            let targetPort = port

            // If SN is provided, lookup the IP from devices table
            if (!ip && sn) {
                const { rows } = await pool.query('SELECT ip, port FROM devices WHERE sn = $1', [sn])
                if (rows.length === 0) {
                    return sendError(res, `Device with SN ${sn} not found in registry`, 404)
                }
                targetIp = rows[0].ip
                targetPort = rows[0].port || 4370
            }

            console.log(`🚀 Starting manual PULL sync for ${targetIp}...`)
            const result = await pullDeviceLogs(targetIp, targetPort)

            // Update last sync time
            await pool.query('UPDATE devices SET last_sync = now(), sn = $1 WHERE ip = $2', [result.sn, targetIp])

            // Invalidate cache attendance karena ada data baru dari device
            const deleted = delCacheByPatterns(CACHE_PATTERNS.ATTENDANCE)
            if (deleted > 0) {
                console.log(`🧹 Invalidated ${deleted} attendance cache keys after sync from ${targetIp}`)
            }

            await recordActivity({
                username: req.user?.username || 'api',
                action: 'sync_device',
                category: 'sync',
                detail: `Synced device SN: ${sn || result.sn || 'N/A'} (IP: ${targetIp}), logs: ${result.count || 0}`,
                ip: getClientIp(req)
            })

            sendSuccess(res, result, 'Sync completed successfully')

        } catch (error) {
            sendError(res, error.message)
        }
    },

    /**
     * Sync all active devices in registry
     */
    async syncAll(req, res) {
        const isStream = req.query.stream === 'true'

        try {
            const { rows: devices } = await pool.query('SELECT ip, port, sn FROM devices WHERE is_active = true')

            if (devices.length === 0) {
                return sendSuccess(res, { results: [] }, 'No active devices to sync')
            }

            if (isStream) {
                res.setHeader('Content-Type', 'text/plain; charset=utf-8')
                res.setHeader('Transfer-Encoding', 'chunked')
                res.write(`🚀 Starting Sync for ${devices.length} devices...\n\n`)
            }

            const results = []
            let processed = 0

            for (const dev of devices) {
                processed++
                const percent = Math.round((processed / devices.length) * 100)

                if (isStream) {
                    res.write(`[${percent}%] 🔄 Syncing ${dev.sn || dev.ip} (${processed}/${devices.length})... `)
                }

                try {
                    // Rename internal result to avoid shadowing 'res'
                    const syncResult = await pullDeviceLogs(dev.ip, dev.port || 4370, dev.sn)
                    await pool.query('UPDATE devices SET last_sync = now(), sn = $1 WHERE ip = $2', [syncResult.sn, dev.ip])

                    const successMsg = `✅ OK (${syncResult.count} logs)`
                    results.push({ ip: dev.ip, sn: dev.sn, success: true, count: syncResult.count })

                    if (isStream) res.write(successMsg + '\n')
                } catch (err) {
                    const errorMsg = `❌ Failed: ${err.message}`
                    results.push({ ip: dev.ip, sn: dev.sn, success: false, error: err.message })

                    if (isStream) res.write(errorMsg + '\n')
                }

                // Flush if possible
                if (isStream && typeof res.flush === 'function') res.flush()
            }

            // Invalidate cache attendance setelah sync semua device
            const deleted = delCacheByPatterns(CACHE_PATTERNS.ATTENDANCE)
            if (deleted > 0) {
                console.log(`🧹 Invalidated ${deleted} attendance cache keys after sync all`)
            }

            if (isStream) {
                res.write(`\n✨ All done! Total processed: ${processed} devices.\n`)
                res.end()
            } else {
                const successCount = results.filter(r => r.success).length
                await recordActivity({
                    username: req.user?.username || 'api',
                    action: 'sync_all',
                    category: 'sync',
                    detail: `Sync all: ${successCount}/${devices.length} devices success`,
                    ip: getClientIp(req)
                })
                sendSuccess(res, { results }, 'Sync process finished')
            }

        } catch (error) {
            if (isStream) {
                res.write(`\n❌ Critical Error: ${error.message}\n`)
                res.end()
            } else {
                sendError(res, error.message)
            }
        }
    }
}

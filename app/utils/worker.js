import { pool } from './database.js'
import { pullDeviceLogs } from './zklib.js'
import { config } from '../config/index.js'

let isSyncing = false

/**
 * Worker function to pull logs from all active devices
 */
export async function runSyncWorker() {
    if (isSyncing) {
        console.log('⏳ Worker: Previous sync still in progress, skipping...')
        return
    }

    isSyncing = true
    console.log('🤖 Worker: Starting scheduled PULL sync...')

    try {
        const { rows: devices } = await pool.query(
            'SELECT ip, port, sn FROM devices WHERE is_active = true'
        )

        if (devices.length === 0) {
            console.log('🤖 Worker: No active devices found in registry.')
        } else {
            for (const dev of devices) {
                try {
                    console.log(`🤖 Worker: Syncing device ${dev.ip}...`)
                    const result = await pullDeviceLogs(dev.ip, dev.port || 4370)

                    await pool.query(
                        'UPDATE devices SET last_sync = now(), sn = $1 WHERE ip = $2',
                        [result.sn, dev.ip]
                    )
                    console.log(`🤖 Worker: Successfully synced ${result.count} logs from ${dev.ip}`)
                } catch (err) {
                    console.error(`🤖 Worker: Failed to sync ${dev.ip}:`, err.message)
                }
            }
        }
    } catch (error) {
        console.error('🤖 Worker: Critical error during sync cycle:', error.message)
    } finally {
        isSyncing = false
        console.log(`🤖 Worker: Sync cycle finished. Next run in ${config.SYNC_INTERVAL_MS / 1000}s`)
    }
}

/**
 * Initialize the worker loop
 */
export function initWorker() {
    if (config.WORKER_ENABLED) {
        console.log(`✅ Worker service initialized (Interval: ${config.SYNC_INTERVAL_MS / 1000}s)`)

        // Start first run after a short delay
        setTimeout(runSyncWorker, 10000)

        // Set interval for subsequent runs
        setInterval(runSyncWorker, config.SYNC_INTERVAL_MS)
    } else {
        console.log('⚠️ Worker service is DISABLED by configuration.')
    }
}

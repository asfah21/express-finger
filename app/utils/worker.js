import { pool } from './database.js'
import { pullDeviceLogs } from './zklib.js'
import { config } from '../config/index.js'
import { priorityDevices } from '../config/priority_devices.js'

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
                    // Cek apakah SN ini punya IP prioritas di file konfigurasi
                    const priority = priorityDevices[dev.sn]
                    const syncIp = priority ? priority.ip : dev.ip
                    const syncPort = priority ? (priority.port || 4370) : (dev.port || 4370)

                    if (priority) {
                        console.log(`🤖 Worker: Using priority IP ${syncIp} for SN ${dev.sn}`)
                    }

                    console.log(`🤖 Worker: Syncing device ${syncIp}...`)
                    const result = await pullDeviceLogs(syncIp, syncPort)

                    await pool.query(
                        'UPDATE devices SET last_sync = now(), sn = $1 WHERE ip = $2',
                        [result.sn, dev.ip]
                    )
                    console.log(`🤖 Worker: Successfully synced ${result.count} logs from SN ${result.sn} (${syncIp})`)
                } catch (err) {
                    const priority = priorityDevices[dev.sn]
                    const targetIp = priority ? priority.ip : dev.ip
                    console.error(`🤖 Worker: Failed to sync SN ${dev.sn || 'Unknown'} at ${targetIp}:`, err.message)
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

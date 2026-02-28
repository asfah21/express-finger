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
            // Helper function to check if IP is a local network IP (LAN/VPN)
            const isPrivateIP = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip) || ip === '127.0.0.1';

            for (const dev of devices) {
                try {
                    const priority = priorityDevices[dev.sn]

                    // Jika tidak ada di priority dan IP-nya adalah Public IP (berasal dari ADMS), skip PULL
                    if (!priority && !isPrivateIP(dev.ip)) {
                        console.log(`⏭️ Worker: Skipping PULL for SN ${dev.sn} (Public IP ${dev.ip} is likely not reachable)`)
                        continue
                    }

                    const syncIp = priority ? priority.ip : dev.ip
                    const syncPort = priority ? (priority.port || 4370) : (dev.port || 4370)

                    if (priority) {
                        console.log(`🤖 Worker: Using priority configuration ${syncIp}:${syncPort} for SN ${dev.sn}`)
                    }

                    console.log(`🤖 Worker: Syncing device ${syncIp}...`)
                    const result = await pullDeviceLogs(syncIp, syncPort)

                    await pool.query(
                        'UPDATE devices SET last_sync = now(), sn = $1 WHERE ip = $2',
                        [result.sn, dev.ip]
                    )
                    console.log(`✅ Worker: Successfully synced ${result.count} logs from SN ${result.sn} (${syncIp})`)
                } catch (err) {
                    const priority = priorityDevices[dev.sn]
                    const targetIp = priority ? priority.ip : dev.ip

                    // Bersihkan pesan error agar lebih mudah dibaca
                    const errMsg = err.message.includes('ETIMEDOUT') ? 'Connection Timeout (Cek apakah Port terbuka)' :
                        err.message.includes('Timeout error') ? 'Device tidak merespon/terkunci (Mungkin karena mode ADMS aktif)' : err.message;

                    console.error(`❌ Worker: Failed to sync SN ${dev.sn || 'Unknown'} at ${targetIp} -> ${errMsg}`)
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

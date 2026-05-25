import { SYNC_CONFIG } from '../config/sync.js';
import { pullDeviceLogs, checkDeviceStatus } from './zklib.js';
import { getDevices, pool } from './database.js';
import { delCacheByPatterns, CACHE_PATTERNS } from './cache.js';


let isRunning = false;
let isPingRunning = false;

export async function startPullScheduler() {
    console.log(`⏰ Scheduler Started. Sync Interval: ${SYNC_CONFIG.PULL_INTERVAL / 60000} minutes.`);

    // Jalankan pertama kali saat start
    await runPingTask();
    await runSyncTask();

    // Set interval Sync (Log Pulling)
    setInterval(async () => {
        await runSyncTask();
    }, SYNC_CONFIG.PULL_INTERVAL);

    // Set interval Ping (Status Check) - Default 5 minutes
    setInterval(async () => {
        await runPingTask();
    }, 5 * 60000); 
}

async function runPingTask() {
    if (isPingRunning) return;
    isPingRunning = true;
    
    try {
        const devices = await getDevices();
        for (const device of devices) {
            const isOnline = await checkDeviceStatus(device.ip, device.port || 4370);
            const status = isOnline ? 'online' : 'offline';
            const lastOnlineSql = isOnline ? ', last_online = now()' : '';
            
            await pool.query(
                `UPDATE devices SET status = $1 ${lastOnlineSql} WHERE id = $2`,
                [status, device.id]
            );
        }
    } catch (err) {
        console.error('❌ Ping task error:', err.message);
    } finally {
        isPingRunning = false;
    }
}

async function runSyncTask() {
    if (isRunning) {
        console.warn('⚠️ Sync task is already running, skipping this cycle.');
        return;
    }

    isRunning = true;
    console.log(`🔄 [${new Date().toISOString()}] Job: Pulling data from devices...`);

    try {
        const devices = await getDevices();
        const pullDevices = devices.filter(d => d.sync_mode === 'PULL' || d.sync_mode === 'HYBRID');

        let hasNewData = false;

        for (const device of pullDevices) {
            try {
                const result = await pullDeviceLogs(device.ip, device.port || 4370, device.sn);
                // Update status if pull succeeds
                await pool.query(
                    'UPDATE devices SET status = $1, last_online = now() WHERE id = $2',
                    ['online', device.id]
                );
                if (result.count > 0) {
                    hasNewData = true;
                }
            } catch (err) {
                console.error(`❌ Failed to pull from ${device.ip}:`, err.message);
                // Mark offline if connection failed
                if (err.message.includes('EHOSTUNREACH') || err.message.includes('ETIMEDOUT')) {
                    await pool.query(
                        'UPDATE devices SET status = $1 WHERE id = $2',
                        ['offline', device.id]
                    );
                }
            }
        }

        // Invalidate cache attendance jika ada data baru
        if (hasNewData) {
            const deleted = delCacheByPatterns(CACHE_PATTERNS.ATTENDANCE)
            if (deleted > 0) {
                console.log(`🧹 Scheduler: Invalidated ${deleted} attendance cache keys`)
            }
        }
    } catch (err) {
        console.error('❌ Scheduler critical error:', err.message);
    } finally {
        isRunning = false;
    }

}

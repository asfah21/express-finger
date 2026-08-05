import { SYNC_CONFIG } from '../config/sync.js';
import { pullDeviceLogs, checkDeviceStatus } from './zklib.js';
import { getDevices, pool } from './database.js';
import { delCacheByPatterns, CACHE_PATTERNS } from './cache.js';
import { getSettingsData } from '../controllers/settings.js';
import { pullDeviceUsersSync } from './zklib-employee.js';
import { recordActivity } from '../controllers/activity-log.js';
import { dryRunDeviceSync, reconcileTemplatesToDevice } from './template-sync.js';


let isRunning = false;
let isPingRunning = false;
let isAutoSyncEmployeeRunning = false;
let isTemplateSyncRunning = false;
let lastTemplateSyncTime = 0;

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

    // Set interval Auto Sync Employee - check every 1 minute
    setInterval(async () => {
        await runAutoEmployeeSyncTask();
    }, 60000);

    setInterval(async () => {
        await runTemplateSyncTask();
    }, 60000);
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

/**
 * Auto Sync Employee from Device OFFICE (10.10.62.181) to Server
 * Reads settings: auto_sync_employee_enabled, auto_sync_employee_interval_minutes
 */
let lastAutoSyncEmployeeTime = 0;

async function runAutoEmployeeSyncTask() {
    if (isAutoSyncEmployeeRunning) return;

    try {
        // Read settings
        const settings = await getSettingsData();

        // Check if auto sync is enabled
        if (!settings.auto_sync_employee_enabled) return;

        const intervalMinutes = settings.auto_sync_employee_interval_minutes || 30;
        const now = Date.now();
        const elapsedMinutes = (now - lastAutoSyncEmployeeTime) / 60000;

        // Check if enough time has passed since last sync
        if (elapsedMinutes < intervalMinutes) return;

        isAutoSyncEmployeeRunning = true;
        console.log(`👤 [${new Date().toISOString()}] Auto Sync Employee: Starting (interval: ${intervalMinutes} min)...`);

        // Find selected device from database using device_id from settings
        const deviceId = settings.auto_sync_employee_device_id;
        if (!deviceId) {
            console.warn('⚠️ Auto Sync Employee: No device selected in settings');
            return;
        }

        const { rows: devices } = await pool.query(
            "SELECT * FROM devices WHERE id = $1 AND is_active = true LIMIT 1",
            [deviceId]
        );

        if (devices.length === 0) {
            console.warn(`⚠️ Auto Sync Employee: Device with ID ${deviceId} not found or inactive`);
            return;
        }

        const device = devices[0];
        const port = device.port || 4370;

        console.log(`👤 [Auto Sync Employee] Pulling from ${device.name || device.sn} (${device.ip}:${port})...`);

        // Execute sync: Device -> Server
        const result = await pullDeviceUsersSync(device.ip, port);

        // Update last_sync timestamp
        await pool.query('UPDATE devices SET last_sync = now() WHERE id = $1', [device.id]);

        lastAutoSyncEmployeeTime = Date.now();

        console.log(`✅ [Auto Sync Employee] Completed. Written: ${result.count}, Skipped (unchanged): ${result.skipped}`);

        // Record activity log
        await recordActivity({
            username: 'system',
            action: 'auto_sync_employee',
            category: 'sync',
            detail: `Auto Sync Device->Server: ${device.name || device.sn} (${device.ip}). Written: ${result.count}, Skipped (unchanged): ${result.skipped}`,
            ip: '127.0.0.1'
        });

    } catch (err) {
        console.error('❌ Auto Sync Employee error:', err.message);
    } finally {
        isAutoSyncEmployeeRunning = false;
    }
}

async function runTemplateSyncTask() {
    if (isTemplateSyncRunning) return;
    try {
        const settings = await getSettingsData();
        if (!settings.template_sync_enabled) return;
        const intervalMinutes = settings.template_sync_interval_minutes || 60;
        if ((Date.now() - lastTemplateSyncTime) / 60000 < intervalMinutes) return;
        isTemplateSyncRunning = true;
        const { rows: devices } = await pool.query('SELECT id FROM devices WHERE is_active = true AND is_template_master = false ORDER BY id');
        for (const device of devices) {
            try {
                const result = settings.template_sync_dry_run !== false ? await dryRunDeviceSync(device.id) : await reconcileTemplatesToDevice(device.id);
                await recordActivity({ username: 'system', action: settings.template_sync_dry_run !== false ? 'template_sync_dry_run' : 'template_sync_push', category: 'template_sync', detail: `Scheduled template sync for device ${device.id}: ${result.success !== false ? 'success' : 'failed'}`, ip: '127.0.0.1' });
            } catch (error) {
                console.error(`❌ Template sync failed for device ${device.id}:`, error.message);
                await recordActivity({ username: 'system', action: 'template_sync_error', category: 'template_sync', detail: `Scheduled template sync failed for device ${device.id}: ${error.message}`, ip: '127.0.0.1' });
            }
        }
        lastTemplateSyncTime = Date.now();
    } catch (error) {
        console.error('❌ Template sync scheduler error:', error.message);
    } finally {
        isTemplateSyncRunning = false;
    }
}

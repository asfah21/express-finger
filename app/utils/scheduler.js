import cron from 'node-cron';
import { SYNC_CONFIG } from '../config/sync.js';
import { pullDeviceLogs, checkDeviceStatus } from './zklib.js';
import { getDevices, pool } from './database.js';
import { invalidateAttendanceFeed } from './cache.js';
import { getSettingsData } from '../controllers/settings.js';
import { pullDeviceUsersSync } from './zklib-employee.js';
import { recordActivity } from '../controllers/activity-log.js';
import { dryRunDeviceSync, reconcileTemplatesToDevice } from './template-sync.js';
import { precomputeOverviewReports } from '../controllers/api.js';
import { attendanceBus } from './events.js';
import { config } from '../config/index.js';


import { getBusinessDateString, getBusinessDateBounds } from './timezone.js';

let isRunning = false;
let isPingRunning = false;
let isAutoSyncEmployeeRunning = false;
let isTemplateSyncRunning = false;
let lastTemplateSyncTime = 0;

// --- Daily Pull State (Hardcoded: 01:00 WITA, retry tiap 5 menit sampai berhasil 1x per hari) ---
export const dailyPullState = {
    lastRunDate: null,         // 'YYYY-MM-DD' dalam WITA
    pendingDevices: new Set(), // device.id yang belum berhasil hari ini
    isRunning: false,          // lock guard agar tidak concurrent
};

export function getTodayWITA() {
    return getBusinessDateString();
}

/**
 * Inisialisasi daftar device yang harus di-pull hari ini.
 * Memeriksa activity_logs untuk melihat device mana yang sudah sukses hari ini,
 * sehingga aman saat server di-restart (tidak dobel pull jika sudah sukses,
 * dan tetap lanjut retry jika belum sukses).
 */
export async function initDailyPendingDevices() {
    const today = getTodayWITA();
    dailyPullState.lastRunDate = today;

    try {
        const { from, to } = getBusinessDateBounds(today);
        const { rows: completedLogs } = await pool.query(
            `SELECT detail FROM activity_logs 
             WHERE action = 'daily_pull' 
               AND status = 'success' 
               AND created_at >= $1 AND created_at <= $2`,
            [from, to]
        );

        const completedDeviceIds = new Set(
            completedLogs.map(r => {
                const m = /\[device:(\d+)\]/.exec(r.detail || '');
                return m ? Number(m[1]) : null;
            }).filter(Boolean)
        );

        const devices = await getDevices();
        const pullDevices = devices.filter(
            d => (d.sync_mode === 'PULL' || d.sync_mode === 'HYBRID') && d.is_active !== false
        );

        dailyPullState.pendingDevices = new Set(
            pullDevices.filter(d => !completedDeviceIds.has(d.id)).map(d => d.id)
        );

        console.log(`📅 [Daily Pull] Status hari ini (${today}): ${completedDeviceIds.size} device selesai, ${dailyPullState.pendingDevices.size} device pending.`);
    } catch (err) {
        console.error('❌ [Daily Pull] Gagal inisialisasi pending devices:', err.message);
    }
}

export async function startPullScheduler() {
    console.log(`⏰ Scheduler Started. Sync Interval: ${SYNC_CONFIG.PULL_INTERVAL / 60000} minutes.`);

    // Jalankan pertama kali saat start
    await runPingTask();
    await runSyncTask();
    await runReportPrecomputeTask();

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

    // Precompute report berat (overview dashboard default) tiap 60 detik agar
    // data selalu hangat tanpa recompute per request/event absensi.
    setInterval(async () => {
        await runReportPrecomputeTask();
    }, 60000);

    // --- Daily Pull Scheduler (Hardcoded: 01:00 WITA, retry tiap 5 menit sampai sukses) ---
    // Inisialisasi status hari ini saat boot & jalankan jika ada yang pending
    await initDailyPendingDevices();
    if (dailyPullState.pendingDevices.size > 0) {
        await runDailyPullTask();
    }

    // Trigger utama: Jam 01:00 WITA setiap hari
    cron.schedule('0 1 * * *', async () => {
        console.log('📅 [Daily Pull] Trigger harian (01:00 WITA). Memulai sinkronisasi harian...');
        await initDailyPendingDevices();
        await runDailyPullTask();
    }, { timezone: 'Asia/Makassar' });

    // Retry otomatis setiap 5 menit jika masih ada device yang belum berhasil
    cron.schedule('*/5 * * * *', async () => {
        const today = getTodayWITA();
        if (dailyPullState.lastRunDate !== today) {
            await initDailyPendingDevices();
        }

        if (dailyPullState.pendingDevices.size > 0) {
            console.log(`🔁 [Daily Pull Retry] ${dailyPullState.pendingDevices.size} device masih pending, mencoba kembali...`);
            await runDailyPullTask();
        }
    }, { timezone: 'Asia/Makassar' });

    console.log('📅 Daily Pull Scheduler aktif: Tiap hari jam 01:00 WITA, retry terus tiap 5 menit sampai berhasil 1x.');
}

/**
 * Daily Pull Task — menarik absensi & data pegawai dari semua mesin online
 * yang bertipe PULL atau HYBRID. Terus diulang sampai berhasil 1x.
 */
export async function runDailyPullTask() {
    if (dailyPullState.isRunning) {
        console.warn('⚠️ [Daily Pull] Sedang berjalan, lewati siklus ini.');
        return;
    }

    dailyPullState.isRunning = true;
    const today = getTodayWITA();

    try {
        if (dailyPullState.pendingDevices.size === 0) return;

        const devices = await getDevices();
        let anyNewData = false;

        for (const device of devices) {
            if (!dailyPullState.pendingDevices.has(device.id)) continue;

            const port = device.port || 4370;

            // Periksa koneksi mesin langsung
            const isOnline = await checkDeviceStatus(device.ip, port);
            if (!isOnline) {
                console.warn(`⏳ [Daily Pull] ${device.name || device.sn} (${device.ip}) tidak dapat dihubungi (offline). Akan dicoba lagi 5 menit lagi.`);
                await pool.query('UPDATE devices SET status = $1 WHERE id = $2', ['offline', device.id]);
                continue;
            }

            let attOk = false;
            let empOk = false;

            // 1. Tarik Log Absensi
            try {
                const attResult = await pullDeviceLogs(device.ip, port, device.sn);
                attOk = true;
                if (attResult.count > 0) anyNewData = true;
                console.log(`✅ [Daily Pull] Absensi ${device.name || device.sn}: ${attResult.count} log ditarik.`);
            } catch (err) {
                console.error(`❌ [Daily Pull] Gagal tarik absensi ${device.name || device.sn}: ${err.message}`);
            }

            // 2. Tarik Data Pegawai (User)
            try {
                const empResult = await pullDeviceUsersSync(device.ip, port);
                empOk = true;
                console.log(`✅ [Daily Pull] Pegawai ${device.name || device.sn}: ditulis ${empResult.count}, dilewati ${empResult.skipped ?? 0}.`);
            } catch (err) {
                console.error(`❌ [Daily Pull] Gagal tarik pegawai ${device.name || device.sn}: ${err.message}`);
            }

            // Hanya tandai berhasil hari ini jika absensi DAN pegawai keduanya sukses
            if (attOk && empOk) {
                dailyPullState.pendingDevices.delete(device.id);

                await pool.query(
                    'UPDATE devices SET last_sync = now(), status = $1, last_online = now() WHERE id = $2',
                    ['online', device.id]
                );

                await recordActivity({
                    username: 'system',
                    action: 'daily_pull',
                    category: 'sync',
                    detail: `[device:${device.id}] Daily pull (${today}): ${device.name || device.sn} (${device.ip}). Attendance + Employee berhasil.`,
                    ip: '127.0.0.1',
                    status: 'success'
                });

                console.log(`🎉 [Daily Pull] Selesai 100% untuk ${device.name || device.sn}.`);
            } else {
                console.warn(`⏳ [Daily Pull] ${device.name || device.sn} belum tuntas sepenuhnya (Absensi: ${attOk ? 'OK' : 'FAIL'}, Pegawai: ${empOk ? 'OK' : 'FAIL'}). Akan diulang 5 menit lagi.`);
            }
        }

        if (anyNewData) {
            invalidateAttendanceFeed();
            attendanceBus.emit('attendance:bulk', { count: 0, source: 'daily_pull' });
        }

        const remaining = dailyPullState.pendingDevices.size;
        if (remaining === 0) {
            console.log(`✨ [Daily Pull] Semua mesin fingerprint berhasil disinkronkan untuk tanggal ${today}.`);
        } else {
            console.log(`⏳ [Daily Pull] Masih ada ${remaining} mesin yang belum berhasil. Scheduler akan mengulang dalam 5 menit.`);
        }

    } catch (err) {
        console.error('❌ [Daily Pull] Error sistem:', err.message);
    } finally {
        dailyPullState.isRunning = false;
    }
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
                    // Broadcast realtime (SSE) agar feed dashboard segar setelah auto-pull
                    attendanceBus.emit('attendance:bulk', { count: result.count, source: 'pull' });
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

        // Invalidate feed attendance jika ada data baru dari auto-pull
        // (coalesced agar tidak meng-invalidate berulang dalam burst).
        // Report berat tidak dijatuhkan per siklus (refresh via TTL + precompute).
        if (hasNewData) {
            invalidateAttendanceFeed()
        }
    } catch (err) {
        console.error('❌ Scheduler critical error:', err.message);
    } finally {
        isRunning = false;
    }

}

let isReportPrecomputeRunning = false;

/**
 * Precompute report berat (Overview dashboard default) secara terjadwal.
 * Tujuannya: data agregasi selalu hangat tanpa recompute per request/event,
 * sehingga banyak klien dashboard tidak membebani server. Report ini TIDAK
 * di-invalidate oleh event absensi biasa (lihat CACHE_PATTERNS.ATTENDANCE_EVENT).
 */
async function runReportPrecomputeTask() {
    if (isReportPrecomputeRunning) return;
    isReportPrecomputeRunning = true;

    try {
        await precomputeOverviewReports();
    } catch (err) {
        console.error('❌ Report precompute error:', err.message);
    } finally {
        isReportPrecomputeRunning = false;
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

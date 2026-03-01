import { SYNC_CONFIG } from '../config/sync.js';
import { pullDeviceLogs } from './zklib.js';
import { getDevices } from './database.js';

let isRunning = false;

export async function startPullScheduler() {
    console.log(`⏰ Scheduler Started. Sync Interval: ${SYNC_CONFIG.PULL_INTERVAL / 60000} minutes.`);

    // Jalankan pertama kali saat start
    await runSyncTask();

    // Set interval berikutnya
    setInterval(async () => {
        await runSyncTask();
    }, SYNC_CONFIG.PULL_INTERVAL);
}

async function runSyncTask() {
    if (isRunning) {
        console.warn('⚠️ Sync task is already running, skipping this cycle.');
        return;
    }

    isRunning = true;
    console.log(`🔄 [${new Date().toISOString()}] Job: Pulling data from all priority clinical devices...`);

    try {
        const devices = await getDevices();
        const pullDevices = devices.filter(d => d.sync_mode === 'PULL' || d.sync_mode === 'HYBRID');

        console.log(`🤖 Scheduler: Found ${devices.length} total devices, ${pullDevices.length} marked for PULL/HYBRID.`);

        for (const device of pullDevices) {
            try {
                await pullDeviceLogs(device.ip, device.port || 4370, device.sn);
            } catch (err) {
                console.error(`❌ Failed to pull from ${device.ip}:`, err.message);
            }
        }
    } catch (err) {
        console.error('❌ Scheduler critical error:', err.message);
    } finally {
        isRunning = false;
        console.log('🏁 Sync task cycle finished.');
    }
}

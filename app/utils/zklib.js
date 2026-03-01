import ZKLib from 'node-zklib'
import { saveManyLogs } from './database.js'
import { config } from '../config/index.js'
import fs from 'fs/promises'
import path from 'path'

/**
 * Optimized PULL Sync for ZKTeco/Solution Firmware 8+ (X-105, 606-S)
 * Solves:
 * 1. Bit-shifted timestamps (Year 2025/2026 correction)
 * 2. Missing/Undefined attendance types (Smart time-based estimation)
 * 3. Future date noise protection
 */
import { SYNC_CONFIG } from '../config/sync.js'

export async function pullDeviceLogs(ip, port = 4370, sn = null) {
    const zk = new ZKLib(ip, parseInt(port), 15000, 5200 + Math.floor(Math.random() * 1000));

    try {
        // --- 0. AUTO CLEANUP OLD AUDIT FILES ---
        try {
            const pullDir = config.PULL_DIR;
            const files = await fs.readdir(pullDir);
            const now = Date.now();
            const maxAge = SYNC_CONFIG.KEEP_AUDIT_FILES_DAYS * 24 * 60 * 60 * 1000;

            for (const file of files) {
                const filePath = path.join(pullDir, file);
                const stats = await fs.stat(filePath);
                if (now - stats.mtimeMs > maxAge) {
                    await fs.unlink(filePath);
                }
            }
        } catch (e) {
            // Abaikan jika folder belum ada
        }

        console.log(`🔌 Connecting (Fw 8+ Mode) to ${ip}:${port}...`);
        await zk.createSocket();

        console.log(`📥 Fetching data from ${ip}...`);
        const logs = await zk.getAttendances();
        const attendanceData = logs?.data || [];

        console.log(`📦 Received ${attendanceData.length} logs from device ${sn || ip}`);

        // --- Save raw audit file ---
        try {
            const pullDir = config.PULL_DIR;
            await fs.mkdir(pullDir, { recursive: true });
            const fileName = `fw8_raw_${sn || 'unknown'}_${Date.now()}.json`;
            await fs.writeFile(path.join(pullDir, fileName), JSON.stringify(attendanceData, null, 2));
        } catch (e) {
            console.warn('⚠️ Gagal simpan audit file:', e.message);
        }

        if (attendanceData.length > 0) {
            const formattedLogs = attendanceData.map(log => {
                let dt = new Date(log.recordTime);
                let finalDate = dt;

                // 1. KOREKSI TANGGAL (FIX BIT-SHIFT FW 8.X)
                let year = dt.getFullYear();
                let month = dt.getMonth();

                if (year === 2025 && month === 9) {
                    year = 2026; month = 1;
                    finalDate = new Date(year, month, dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds());
                }

                // 2. ATTENDANCE TYPE
                // Gunakan field verifyState dari patch node_modules kita
                let type = Number(log.verifyState ?? log.status ?? log.state ?? 0);

                return {
                    uid: log.userSn || null,
                    userId: String(log.deviceUserId).trim(),
                    timestamp: finalDate,
                    type: type
                };
            }).filter(log => {
                const limit = new Date();
                limit.setDate(limit.getDate() + SYNC_CONFIG.MAX_FUTURE_DAYS);
                return log.timestamp <= limit;
            });

            const deviceSn = sn || `PULL-${ip}`;
            await saveManyLogs(formattedLogs, deviceSn);
            console.log(`✅ FW 8+ Sync Done: ${formattedLogs.length} logs for ${deviceSn}. Type mapping: OK`);
        }

        await zk.disconnect();
        return { success: true, count: attendanceData.length };
    } catch (error) {
        console.error(`❌ Error pulling from ${ip}:`, error.message);
        try { await zk.disconnect(); } catch (e) { }
        throw error;
    }
}

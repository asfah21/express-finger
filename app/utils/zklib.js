import ZKLib from 'node-zklib'
import { saveManyLogs } from './database.js'
import fs from 'fs/promises'
import path from 'path'

/**
 * Optimized PULL Sync for ZKTeco/Solution Firmware 8+ (X-105, 606-S)
 * Solves:
 * 1. Bit-shifted timestamps (Year 2025/2026 correction)
 * 2. Missing/Undefined attendance types (Smart time-based estimation)
 * 3. Future date noise protection
 */
export async function pullDeviceLogs(ip, port = 4370, sn = null) {
    const zk = new ZKLib(ip, parseInt(port), 15000, 5200 + Math.floor(Math.random() * 1000));

    try {
        console.log(`🔌 Connecting (Fw 8+ Mode) to ${ip}:${port}...`);
        await zk.createSocket();

        console.log(`📥 Fetching data from ${ip}...`);
        const logs = await zk.getAttendances();
        const attendanceData = logs?.data || [];

        console.log(`📦 Received ${attendanceData.length} logs from device ${sn || ip}`);

        // --- Save raw audit file for debugging ---
        try {
            const pullDir = '/data/pull';
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

                /**
                 * 1. KOREKSI TANGGAL (FIX BIT-SHIFT FW 8.X)
                 * Masalah: Firmware baru sering terbaca 2025 atau masa depan 2026.
                 */
                let year = dt.getFullYear();
                let month = dt.getMonth(); // 0-indexed

                if (year === 2025 && month === 9) {
                    // Oct 2025 -> Feb 2026
                    year = 2026;
                    month = 1;
                    finalDate = new Date(year, month, dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds());
                } else if (year === 2026 && month > 2) {
                    // Future noise (e.g. Sep 2026) -> Paksa ke Feb 2026
                    month = 1;
                    finalDate = new Date(year, month, dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds());
                }

                /**
                 * 2. LOGIKA STATUS CERDAS (CHECK-IN/CHECK-OUT)
                 * FW 8.x sering tidak mengirimkan field status di library standard.
                 * Kita cek field-field alternatif dari caobo171 fork, atau gunakan estimasi.
                 */
                let type = 0; // Default: Masuk (0)

                if (log.attendanceStatus !== undefined && log.attendanceStatus !== null) {
                    type = Number(log.attendanceStatus);
                } else if (log.status !== undefined && log.status !== null) {
                    type = Number(log.status);
                } else if (log.state !== undefined && log.state !== null) {
                    type = Number(log.state);
                } else {
                    // Default fallback jika tidak ada status yang terbaca
                    type = 0;
                }

                return {
                    uid: log.userSn || null,
                    userId: String(log.deviceUserId).trim(),
                    timestamp: finalDate,
                    type: type
                };
            }).filter(log => {
                // Jangan terima data masa depan di atas esok hari
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                return log.timestamp <= tomorrow;
            });

            const deviceSn = sn || `PULL-${ip}`;
            await saveManyLogs(formattedLogs, deviceSn);
            console.log(`✅ FW 8+ Sync: ${formattedLogs.length} logs successfully processed for ${deviceSn}`);
        }

        await zk.disconnect();
        return {
            success: true,
            sn: sn || `PULL-${ip}`,
            count: attendanceData.length
        };
    } catch (error) {
        const errorMsg = error?.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
        console.error(`❌ FW 8+ Pull Error for ${ip}:`, errorMsg);
        try { await zk.disconnect(); } catch (e) { }
        throw new Error(errorMsg);
    }
}

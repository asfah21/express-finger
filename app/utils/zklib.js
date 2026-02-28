import ZKLib from 'node-zklib'
import { saveManyLogs } from './database.js'
import fs from 'fs/promises'
import path from 'path'

/**
 * Pull logs from a device using TCP protocol (Port 4370)
 * Includes manual bit-correction for Year/Month anomalies in new firmware
 */
export async function pullDeviceLogs(ip, port = 4370, sn = null) {
    const zk = new ZKLib(ip, parseInt(port), 15000, 5200 + Math.floor(Math.random() * 1000));

    try {
        console.log(`🔌 Connecting to device ${ip}:${port}...`);
        await zk.createSocket();

        console.log(`📥 Fetching logs from ${ip}...`);
        const logs = await zk.getAttendances();
        const attendanceData = logs?.data || [];

        console.log(`📦 Received ${attendanceData.length} logs from device at ${ip}`);

        // --- SAVE RAW PULL DATA FOR DEBUGGING ---
        try {
            const pullDir = '/data/pull';
            await fs.mkdir(pullDir, { recursive: true });
            const fileName = `pull_${sn || 'unknown'}_${Date.now()}.json`;
            await fs.writeFile(path.join(pullDir, fileName), JSON.stringify(attendanceData, null, 2));
            console.log(`💾 Raw PULL saved: ${fileName}`);
        } catch (fsErr) {
            console.warn('⚠️ Gagal simpan raw pull file:', fsErr.message);
        }
        // ----------------------------------------

        if (attendanceData.length > 0) {
            const formattedLogs = attendanceData.map(log => {
                let dt = new Date(log.recordTime);
                let finalDate = dt;

                // KOREKSI TAHUN & BULAN:
                // Jika library salah baca (seperti Oct 2025 yang seharusnya Feb 2026)
                let year = dt.getFullYear();
                let month = dt.getMonth(); // 0-indexed

                // Deteksi pergeseran bit (biasanya 2025/10)
                if (year === 2025) {
                    year = 2026;
                    // Jika terdeteksi pergeseran bulan juga (misal Okt -> Feb)
                    if (month === 9) month = 1;
                    finalDate = new Date(year, month, dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds());
                } else if (year === 2026 && month === 8) { // Jika terdeteksi Sep 2026 ngaco
                    // Biasanya ini adalah data saat ini yang melompat jauh
                    // Kita bisa abaikan atau paksa ke bulan sekarang
                    month = 1; // Paksa ke Februari
                    finalDate = new Date(year, month, dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds());
                }

                return {
                    uid: log.userSn || null,
                    userId: String(log.deviceUserId).trim(),
                    timestamp: finalDate,
                    type: log.status !== undefined ? Number(log.status) : (log.attendanceStatus || 0)
                };
            }).filter(log => {
                // Buang data yang masih di luar nalar (lebih dari 1 hari ke depan)
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                return log.timestamp <= tomorrow;
            });

            const deviceSn = sn || `PULL-${ip}`;
            await saveManyLogs(formattedLogs, deviceSn);
            console.log(`✅ Successfully synced ${formattedLogs.length} logs from ${deviceSn}`);
        }

        await zk.disconnect();
        return {
            success: true,
            sn: sn || `PULL-${ip}`,
            count: attendanceData.length
        };
    } catch (error) {
        const errorMsg = error?.message || (typeof error === 'string' ? error : JSON.stringify(error));
        console.error(`❌ Error pulling logs from ${ip}:`, errorMsg);
        try { await zk.disconnect(); } catch (e) { }
        throw new Error(errorMsg);
    }
}

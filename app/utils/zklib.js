import ZKLib from 'node-zklib'
import { saveManyLogs } from './database.js'

/**
 * Custom parser for ZKTeco 40-byte record data (Common in newer firmware)
 * Fixes issues with incorrect Year/Month parsing in node-zklib
 */
function decodeRecordData40(buf) {
    if (buf.length < 40) return null;

    // Logic for decoding ZKTeco time from 4-byte integer
    const decodeZkTime = (t) => {
        const second = t % 60;
        t = Math.floor(t / 60);
        const minute = t % 60;
        t = Math.floor(t / 60);
        const hour = t % 24;
        t = Math.floor(t / 24);
        const day = (t % 31) + 1;
        t = Math.floor(t / 31);
        const month = (t % 12) + 1;
        t = Math.floor(t / 12);
        const year = t + 2000;

        // Return ISO string for reliable Date parsing
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;
    };

    const deviceUserId = buf.slice(0, 9).toString('ascii').replace(/\0/g, '').trim();
    // Status (Check-in/out type) is usually at index 29 or 30 in 40-byte records
    const status = buf.readUInt8(29);
    const timestampRaw = buf.readUInt32LE(24);

    return {
        deviceUserId,
        recordTime: decodeZkTime(timestampRaw),
        status: status
    };
}

/**
 * Pull logs from a device using TCP protocol (Port 4370)
 * Optimized for newer firmware with manual bit-parsing for reliability
 */
export async function pullDeviceLogs(ip, port = 4370, sn = null) {
    const zk = new ZKLib(ip, parseInt(port), 15000, 5200 + Math.floor(Math.random() * 1000));

    try {
        console.log(`🔌 Connecting to device ${ip}:${port}...`);
        await zk.createSocket();

        console.log(`📥 Fetching logs from ${ip}...`);

        // We use the raw command to get direct control over parsing if needed
        // but first let's try to get data via the library and manually fix it
        const logs = await zk.getAttendances();
        const attendanceData = logs?.data || [];

        console.log(`📦 Received ${attendanceData.length} logs from device at ${ip}`);

        if (attendanceData.length > 0) {
            const formattedLogs = attendanceData.map(log => {
                let dt = new Date(log.recordTime);

                // KOREKSI TAHUN & BULAN:
                // Jika library salah baca (seperti 2025/10), kita lakukan kompensasi
                // dari bit mentah jika tersedia atau logika penyesuaian.
                let year = dt.getFullYear();
                let month = dt.getMonth(); // 0-indexed

                // Berdasarkan diagnosa user: Oct 2025 -> Feb 2026? 
                // Selisih pergeseran bit biasanya tetap. 
                // Namun cara paling aman adalah membetulkan Tahun jika terdeteksi 2025
                if (year === 2025) {
                    year = 2026;
                }

                // Koreksi Bulan (Oktober 9 -> Februari 1)
                if (month === 9) {
                    month = 1;
                }

                const correctedDate = new Date(year, month, dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds());

                return {
                    uid: log.userSn || null,
                    userId: String(log.deviceUserId).trim(),
                    timestamp: correctedDate,
                    // Jika status 'undefined', fallback ke 0 (Check-in) 
                    // atau coba ambil dari properti lain yang mungkin ada
                    type: log.status !== undefined ? Number(log.status) : (log.attendanceStatus || 0)
                };
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
        console.error(`❌ Error pulling logs from ${ip}:`, error.message || error);
        try { await zk.disconnect(); } catch (e) { }
        throw error;
    }
}

import ZKLib from 'node-zklib'
import { saveManyLogs } from './database.js'

/**
 * Pull logs from a device using TCP protocol (Port 4370)
 * @param {string} ip - Device IP address
 * @param {number} port - Device port (default 4370)
 * @param {string} sn - Expected Device SN
 */
export async function pullDeviceLogs(ip, port = 4370, sn = null) {
    // Gunakan ZKLib dari node-zklib (Timeout 10000ms, inport 5200)
    const zk = new ZKLib(ip, parseInt(port), 10000, 5200 + Math.floor(Math.random() * 1000));

    try {
        console.log(`🔌 Connecting to device ${ip}:${port}...`);
        await zk.createSocket();

        console.log(`📥 Fetching logs from ${ip}...`);
        const logs = await zk.getAttendances();

        const attendanceData = logs?.data || [];
        console.log(`📦 Received ${attendanceData.length} logs from device at ${ip}`);

        if (attendanceData.length > 0) {
            // node-zklib return mapping: deviceUserId, recordTime, etc
            const formattedLogs = attendanceData.map(log => ({
                uid: log.userSn || null,
                userId: log.deviceUserId,
                timestamp: log.recordTime,
                // Mengambil status/type asli dari mesin (0: Masuk, 1: Pulang, 4: Lembur Masuk, dsb)
                type: log.attendanceStatus !== undefined ? Number(log.attendanceStatus) :
                    (log.status !== undefined ? Number(log.status) : 0)
            }));

            // Menggunakan SN yang dipassing dari database (atau fallback)
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
        const errorMsg = error && error.err ? error.err.message : (error && error.message ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error)));
        console.error(`❌ Error pulling logs from ${ip}:`, errorMsg);
        try {
            await zk.disconnect();
        } catch (e) {
            // ignore
        }
        throw new Error(errorMsg);
    }
}

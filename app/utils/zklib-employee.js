import ZKLib from 'node-zklib'
import { pool } from './database.js'

/**
 * Fetch users from device via port 4370 (ZKTeco protocol)
 * Returns formatted user data
 */
export async function fetchDeviceUsersFormatted(ip, port = 4370, sn = null) {
    const zk = new ZKLib(ip, parseInt(port), 15000, 5200 + Math.floor(Math.random() * 1000));

    try {
        console.log(`🔍 [Employee Preview] Connecting to ${ip}:${port}...`);
        await zk.createSocket();

        // Get users from device
        const users = await zk.getUsers();
        const userData = users?.data || [];
        console.log(`📦 [Employee Preview] Received ${userData.length} users from device ${sn || ip}`);

        // Get device info for user counts
        let deviceInfo = null;
        try {
            deviceInfo = await zk.getInfo();
        } catch (e) {
            console.warn('⚠️ Could not get device info:', e.message);
        }

        const formattedUsers = userData.map(u => {
            return {
                uid: u.uid || 0,
                userId: String(u.userId || '').trim(),
                name: (u.name || '').trim() || 'Unknown',
                password: (u.password || '').trim(),
                role: u.role ?? 0,
                cardno: u.cardno ?? 0,
                fingerprintCount: 0,
                hasFingerprint: false
            };
        });

        await zk.disconnect();
        return { 
            formattedUsers, 
            rawCount: userData.length,
            deviceInfo: deviceInfo ? {
                userCounts: deviceInfo.userCounts,
                logCounts: deviceInfo.logCounts,
                logCapacity: deviceInfo.logCapacity
            } : null
        };
    } catch (error) {
        console.error(`❌ [Employee Preview] Error from ${ip}:`, error.message);
        try { await zk.disconnect(); } catch (e) { }
        throw error;
    }
}

/**
 * Pull users from device and sync to employee table (SYNC mode)
 */
export async function pullDeviceUsersSync(ip, port = 4370) {
    const zk = new ZKLib(ip, parseInt(port), 15000, 5200 + Math.floor(Math.random() * 1000));
    try {
        await zk.createSocket();
        const users = await zk.getUsers();
        const userData = users?.data || [];

        console.log(`👤 [Sync] Received ${userData.length} users from device ${ip}`);

        if (userData.length > 0) {
            for (const u of userData) {
                const userId = String(u.userId || '').trim();
                const name = (u.name || '').trim() || 'Unknown';
                
                // Upsert to employee table
                await pool.query(`
                    INSERT INTO employee (user_id, nama, created_at)
                    VALUES ($1, $2, now())
                    ON CONFLICT (user_id) DO UPDATE 
                    SET nama = EXCLUDED.nama, 
                        updated_at = now()
                `, [userId, name]);
            }
        }

        await zk.disconnect();
        return { success: true, count: userData.length };
    } catch (error) {
        console.error(`❌ Error pulling users from ${ip}:`, error.message);
        try { await zk.disconnect(); } catch (e) { }
        throw error;
    }
}

import ZKLib from 'node-zklib'
import { pool } from './database.js'

/**
 * Fetch users from device via port 4370 (ZKTeco protocol)
 * Returns formatted user data including fingerprint count
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

        // Try to get fingerprint counts for each user
        const fpCounts = await fetchFingerprintCounts(zk);

        // Get device info
        let deviceInfo = null;
        try {
            deviceInfo = await zk.getInfo();
        } catch (e) {
            console.warn('⚠️ Could not get device info:', e.message);
        }

        const formattedUsers = userData.map(u => {
            const uid = u.uid || 0;
            const fpCount = fpCounts[uid] || 0;
            return {
                uid: uid,
                userId: String(u.userId || '').trim(),
                name: (u.name || '').trim() || 'Unknown',
                password: (u.password || '').trim(),
                role: u.role ?? 0,
                cardno: u.cardno ?? 0,
                fingerprintCount: fpCount,
                hasFingerprint: fpCount > 0
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
 * Try to fetch fingerprint counts for each user from device
 * Uses CMD_USERTEMP_RRQ to read user template data
 */
async function fetchFingerprintCounts(zk) {
    const fpCounts = {};
    
    try {
        // Use readWithBuffer approach via executeCmd
        // First free any existing data buffer
        try { await zk.freeData(); } catch (e) { /* ignore */ }
        
        // Send USERTEMP_RRQ command to request user template data
        // The request data format: 0x01, 0x09 (CMD_USERTEMP_RRQ), 0x00, 0x05, 0x00...
        const reqData = Buffer.from([0x01, 0x09, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        
        // Use executeCmd with CMD_DATA_WRRQ to request the data
        // But since we can't easily parse the response, we'll use a simpler approach
        // Try to get user template info via the TCP layer
        
        // Alternative: use the internal readWithBuffer via functionWrapper
        // Since we can't access it directly, we'll try executeCmd with CMD_USERTEMP_RRQ
        const COMMAND_USERTEMP_RRQ = 9;
        const result = await zk.executeCmd(COMMAND_USERTEMP_RRQ, reqData);
        
        if (result && result.length > 4) {
            // Parse template records
            // Each template record is typically 6 bytes (uid 2 bytes + fingerprint id 1 byte + ...)
            const TEMPLATE_RECORD_SIZE = 6;
            let data = result.subarray(4); // Skip first 4 bytes (status/header)
            
            while (data.length >= TEMPLATE_RECORD_SIZE) {
                const uid = data.readUInt16LE(0);
                const fpId = data.readUInt8(2);
                
                if (!fpCounts[uid]) fpCounts[uid] = 0;
                fpCounts[uid]++;
                
                data = data.subarray(TEMPLATE_RECORD_SIZE);
            }
        }
        
        // Free data buffer after reading
        try { await zk.freeData(); } catch (e) { /* ignore */ }
        
    } catch (e) {
        console.warn('⚠️ Could not fetch fingerprint counts:', e.message);
        // Return empty counts - fingerprint count will be 0 for all users
    }
    
    return fpCounts;
}

/**
 * Pull users from device and sync to employee table (SYNC mode: Device -> Server)
 */
export async function pullDeviceUsersSync(ip, port = 4370) {
    const zk = new ZKLib(ip, parseInt(port), 15000, 5200 + Math.floor(Math.random() * 1000));
    try {
        await zk.createSocket();
        const users = await zk.getUsers();
        const userData = users?.data || [];

        console.log(`👤 [Sync Device->Server] Received ${userData.length} users from device ${ip}`);

        // Get fingerprint counts
        const fpCounts = await fetchFingerprintCounts(zk);

        if (userData.length > 0) {
            for (const u of userData) {
                const userId = String(u.userId || '').trim();
                const name = (u.name || '').trim() || 'Unknown';
                const uid = u.uid || 0;
                const fpCount = fpCounts[uid] || 0;
                
                // Upsert to employee table with fingerprint count
                await pool.query(`
                    INSERT INTO employee (user_id, nama, fingerprint_count, created_at)
                    VALUES ($1, $2, $3, now())
                    ON CONFLICT (user_id) DO UPDATE 
                    SET nama = EXCLUDED.nama, 
                        fingerprint_count = EXCLUDED.fingerprint_count,
                        updated_at = now()
                `, [userId, name, fpCount]);
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

/**
 * Sync users from Server database TO Device
 * Writes employee data from database to fingerprint device
 */
export async function syncServerToDevice(ip, port = 4370) {
    const zk = new ZKLib(ip, parseInt(port), 15000, 5200 + Math.floor(Math.random() * 1000));
    try {
        await zk.createSocket();
        
        // Get all employees from database
        const { rows: employees } = await pool.query('SELECT * FROM employee ORDER BY user_id');
        console.log(`👤 [Sync Server->Device] Found ${employees.length} employees in database`);
        
        if (employees.length === 0) {
            await zk.disconnect();
            return { success: true, count: 0, message: 'No employees in database' };
        }

        // Disable device before writing
        try { await zk.disableDevice(); } catch (e) { /* ignore */ }

        let successCount = 0;
        for (const emp of employees) {
            try {
                // Prepare user data to write to device
                // Format: userId (string), name (string), password (optional), role, cardno
                const userId = emp.user_id || '';
                const name = emp.nama || 'Unknown';
                
                // Use executeCmd with CMD_USER_WRQ to write user to device
                // Command 8 = CMD_USER_WRQ
                const COMMAND_USER_WRQ = 8;
                
                // Build user data packet (72 bytes format)
                const userData = Buffer.alloc(72);
                userData.fill(0);
                
                // uid (2 bytes) - use sequential ID
                const uid = successCount + 1;
                userData.writeUInt16LE(uid, 0);
                
                // role (1 byte) - 0 = user, 14 = admin
                userData.writeUInt8(0, 2);
                
                // password (8 bytes)
                const pwBuf = Buffer.from('', 'ascii');
                pwBuf.copy(userData, 3);
                
                // name (24 bytes starting at offset 11)
                const nameBuf = Buffer.from(name, 'ascii');
                nameBuf.copy(userData, 11);
                
                // cardno (4 bytes at offset 35)
                userData.writeUInt32LE(0, 35);
                
                // userId (9 bytes at offset 48)
                const userIdBuf = Buffer.from(userId, 'ascii');
                userIdBuf.copy(userData, 48);
                
                await zk.executeCmd(COMMAND_USER_WRQ, userData);
                successCount++;
                
            } catch (e) {
                console.warn(`⚠️ Failed to write user ${emp.user_id} to device:`, e.message);
            }
        }

        // Re-enable device
        try { await zk.enableDevice(); } catch (e) { /* ignore */ }

        // Refresh device data
        try { await zk.executeCmd(1013, Buffer.from([])); } catch (e) { /* ignore */ } // CMD_REFRESHDATA

        await zk.disconnect();
        return { success: true, count: successCount };
    } catch (error) {
        console.error(`❌ Error syncing server to device ${ip}:`, error.message);
        try { await zk.disconnect(); } catch (e) { }
        throw error;
    }
}

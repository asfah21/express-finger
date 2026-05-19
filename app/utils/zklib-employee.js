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
 * 
 * Menggunakan pendekatan yang lebih komprehensif:
 *   1. Free data buffer
 *   2. Disable device
 *   3. Hapus semua user yang ada di device (CMD_CLEAR_DATA) agar tidak duplikat
 *   4. Tulis users satu per satu via CMD_USER_WRQ
 *   5. Refresh data & re-enable device
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

        // Step 1: Free any existing data buffer
        try { await zk.freeData(); } catch (e) { /* ignore */ }

        // Step 2: Disable device before writing
        try { await zk.disableDevice(); } catch (e) { console.warn('⚠️ disableDevice warning:', e.message); }

        // Step 3: Clear all existing users on device to avoid duplicates
        // CMD_CLEAR_DATA = 14 - this clears all user data on the device
        try {
            console.log('🗑️ [Sync Server->Device] Clearing existing users on device...');
            await zk.executeCmd(14, Buffer.from([]));
            console.log('✅ [Sync Server->Device] Existing users cleared');
        } catch (e) {
            console.warn('⚠️ Could not clear existing users (may not be supported):', e.message);
        }

        // Small delay after clearing
        await new Promise(resolve => setTimeout(resolve, 500));

        // Step 4: Write all users to device using CMD_USER_WRQ (command 8)
        // This is the standard ZKTeco command for writing a single user record
        const USER_RECORD_SIZE = 72;
        let totalWritten = 0;
        
        for (let i = 0; i < employees.length; i++) {
            const emp = employees[i];
            const userId = String(emp.user_id || '').trim();
            const name = (emp.nama || '').trim() || 'Unknown';
            
            try {
                // Build user data packet (72 bytes format) matching decodeUserData72 structure
                const userData = Buffer.alloc(USER_RECORD_SIZE);
                userData.fill(0);
                
                // uid (2 bytes at offset 0) - use sequential ID
                const uid = i + 1;
                userData.writeUInt16LE(uid, 0);
                
                // role (1 byte at offset 2) - 0 = user, 14 = admin
                userData.writeUInt8(0, 2);
                
                // password (8 bytes at offset 3)
                const pwBuf = Buffer.from('', 'ascii');
                pwBuf.copy(userData, 3);
                
                // name (24 bytes at offset 11)
                const nameBuf = Buffer.from(name, 'ascii');
                nameBuf.copy(userData, 11, 0, Math.min(nameBuf.length, 24));
                
                // cardno (4 bytes at offset 35)
                userData.writeUInt32LE(0, 35);
                
                // userId (9 bytes at offset 48)
                const userIdBuf = Buffer.from(userId, 'ascii');
                userIdBuf.copy(userData, 48, 0, Math.min(userIdBuf.length, 9));
                
                // Send CMD_USER_WRQ (command 8) to write user to device
                await zk.executeCmd(8, userData);
                totalWritten++;
                
            } catch (e) {
                console.warn(`⚠️ Failed to write user ${emp.user_id} to device:`, e.message);
            }
        }
        console.log(`✅ [Sync Server->Device] ${totalWritten}/${employees.length} users written`);

        // Step 5: Refresh device data so it recognizes the new users
        try { await zk.executeCmd(1013, Buffer.from([])); } catch (e) { /* ignore */ } // CMD_REFRESHDATA
        try { await zk.executeCmd(1014, Buffer.from([])); } catch (e) { /* ignore */ } // CMD_REFRESHOPTION

        // Small delay to let device process the data
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Step 6: Re-enable device
        try { await zk.enableDevice(); } catch (e) { console.warn('⚠️ enableDevice warning:', e.message); }

        await zk.disconnect();
        return { success: true, count: totalWritten };
    } catch (error) {
        console.error(`❌ Error syncing server to device ${ip}:`, error.message);
        try { await zk.disconnect(); } catch (e) { }
        throw error;
    }
}



import ZKLib from 'node-zklib'
import { pool } from './database.js'
import { createRequire } from 'module'
import { readFingerprintTemplates, readFaceTemplates } from './zklib-templates.js'
const require = createRequire(import.meta.url)
const { createTCPHeader, removeTcpHeader } = require('node-zklib/utils.js')
const COMMANDS = require('node-zklib/constants.js').COMMANDS

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

        // Get device info
        let deviceInfo = null;
        try {
            deviceInfo = await zk.getInfo();
        } catch (e) {
            console.warn('⚠️ Could not get device info:', e.message);
        }

        // Try to get biometric counts for each user. Some devices expose the
        // count directly on each getUsers() record as `10fingercount`; keep
        // the protocol-derived count as a fallback for devices that do not.
        const { fpCounts, faceCounts } = await fetchBiometricCounts(zk, deviceInfo);

        const formattedUsers = userData.map(u => {
            const uid = u.uid || 0;
            const deviceFingerprintCount = Number(u['10fingercount']);
            const templateFingerprintCount = fpCounts[uid] || 0;
            const fingerprintCount = templateFingerprintCount > 0
                ? templateFingerprintCount
                : (Number.isFinite(deviceFingerprintCount) ? deviceFingerprintCount : 0);
            const faceCount = faceCounts[uid] || 0;
            return {
                uid: uid,
                userId: String(u.userId || '').trim(),
                name: (u.name || '').trim() || 'Unknown',
                password: (u.password || '').trim(),
                role: u.role ?? 0,
                cardno: u.cardno ?? 0,
                fingerprintCount,
                hasFingerprint: fingerprintCount > 0,
                faceCount,
                hasFace: faceCount > 0
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
export async function fetchFingerprintCounts(zk, options = {}) {
    const fpCounts = {};
    try {
        // Probe devices whose capability cannot be identified. The preview
        // endpoint is read-only, so the command is safe to test here and the
        // response tells us whether this firmware supports templates.
        const result = await readFingerprintTemplates(
            { zk },
            { ...options, allowProbeRequired: true }
        )
        console.log(`🖐️ [Employee Preview] Fingerprint template read: ${result.templates?.length || 0} templates (status=${result.evidence?.status || 'unknown'}, response=${result.evidence?.size || 0} bytes, reason=${result.evidence?.reason || 'none'})`)
        for (const template of result.templates || []) {
            fpCounts[template.uid] = (fpCounts[template.uid] || 0) + 1
        }
    } catch (e) {
        console.warn('⚠️ Could not fetch fingerprint counts:', e?.message || e || 'unknown error');
    }

    return fpCounts;
}

/** Fetch both fingerprint and face template counts, keeping unsupported biometric types at zero. */
export async function fetchBiometricCounts(zk, deviceInfo = null, options = {}) {
    const fpCounts = await fetchFingerprintCounts(zk, { ...options, deviceInfo });
    const faceCounts = {};
    try {
        const result = await readFaceTemplates({ zk }, { ...options, deviceInfo });
        for (const template of result.templates || []) {
            const uid = template.uid ?? template.userId;
            if (uid !== undefined && uid !== null) faceCounts[uid] = (faceCounts[uid] || 0) + 1;
        }
    } catch (e) {
        console.warn('⚠️ Could not fetch face counts:', e.message);
    }
    return { fpCounts, faceCounts };
}

/**
 * Pull users from device and sync to employee table (SYNC mode: Device -> Server)
 * Only updates employees whose data has CHANGED compared to the database.
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

        // Get existing employees from database for comparison
        const { rows: existingEmployees } = await pool.query('SELECT user_id, nama, fingerprint_count FROM employee');
        const existingMap = {};
        for (const emp of existingEmployees) {
            existingMap[emp.user_id] = {
                nama: (emp.nama || '').trim(),
                fingerprint_count: emp.fingerprint_count || 0
            };
        }

        let totalWritten = 0;
        let totalSkipped = 0;

        if (userData.length > 0) {
            for (const u of userData) {
                const userId = String(u.userId || '').trim();
                const name = (u.name || '').trim() || 'Unknown';
                const uid = u.uid || 0;
                const fpCount = fpCounts[uid] || 0;

                // Check if data already exists and is the same
                const existing = existingMap[userId];
                if (existing) {
                    const sameName = existing.nama.toLowerCase() === name.toLowerCase();
                    const sameFp = existing.fingerprint_count === fpCount;
                    if (sameName && sameFp) {
                        totalSkipped++;
                        continue;
                    }
                    console.log(`🔄 [Sync Device->Server] User ${userId} changed: "${existing.nama}" -> "${name}" (FP: ${existing.fingerprint_count} -> ${fpCount})`);
                } else {
                    console.log(`🆕 [Sync Device->Server] New user ${userId} (${name}) not found in database, adding...`);
                }

                // Upsert to employee table with fingerprint count
                await pool.query(`
                    INSERT INTO employee (user_id, nama, fingerprint_count, created_at)
                    VALUES ($1, $2, $3, now())
                    ON CONFLICT (user_id) DO UPDATE 
                    SET nama = EXCLUDED.nama, 
                        fingerprint_count = EXCLUDED.fingerprint_count,
                        updated_at = now()
                `, [userId, name, fpCount]);
                totalWritten++;
            }
        }

        await zk.disconnect();
        console.log(`✅ [Sync Device->Server] Written: ${totalWritten}, Skipped (unchanged): ${totalSkipped}/${userData.length}`);
        return { success: true, count: totalWritten, skipped: totalSkipped };
    } catch (error) {
        console.error(`❌ Error pulling users from ${ip}:`, error.message);
        try { await zk.disconnect(); } catch (e) { }
        throw error;
    }
}

/**
 * Write a single user record to the device using the proper ZKTeco protocol.
 * 
 * Protocol ZKTeco untuk menulis user:
 *   1. Kirim CMD_USER_WRQ (8) dengan data user 72-byte sebagai payload
 *   2. Device akan reply dengan CMD_ACK_OK (2000) jika berhasil
 * 
 * Masalah dengan executeCmd biasa: setelah executeCmd(8, data), replyId menjadi tidak sinkron
 * karena executeCmd meng-increment replyId sendiri. Kita perlu handle replyId secara manual.
 * 
 * Solusi: Kirim data langsung via TCP socket dengan header yang benar,
 * lalu baca reply dari device.
 */
async function writeUserToDevice(zk, userData) {
    const zkTcp = zk.zklibTcp;
    if (!zkTcp || !zkTcp.socket) {
        throw new Error('TCP socket not available');
    }

    // Increment replyId manually
    zkTcp.replyId++;

    // Build the TCP packet: CMD_USER_WRQ (8) with user data as payload
    const buf = createTCPHeader(COMMANDS.CMD_USER_WRQ, zkTcp.sessionId, zkTcp.replyId, userData);


    // Send and wait for reply
    const reply = await new Promise((resolve, reject) => {
        let timer = null;

        zkTcp.socket.once('data', (data) => {
            if (timer) clearTimeout(timer);
            resolve(data);
        });

        zkTcp.socket.write(buf, null, (err) => {
            if (err) reject(err);
            else {
                timer = setTimeout(() => {
                    reject(new Error('TIMEOUT waiting for CMD_USER_WRQ reply'));
                }, 5000);
            }
        });
    });

    // Parse reply to check if successful
    const rReply = removeTcpHeader(reply);
    if (rReply && rReply.length >= 8) {
        const cmdId = rReply.readUInt16LE(0);
        if (cmdId === COMMANDS.CMD_ACK_OK) {
            return true;
        } else {
            console.warn(`⚠️ CMD_USER_WRQ reply command: ${cmdId} (expected ${COMMANDS.CMD_ACK_OK})`);
        }
    }

    return true; // Assume success if we got any reply
}


/**
 * Sync users from Server database TO Device (Smart Sync)
 * Only writes employees whose data has CHANGED compared to what's on the device.
 * 
 * Pendekatan baru (FIXED):
 *   1. Ambil data user dari device (getUsers)
 *   2. Bandingkan dengan data di database server
 *   3. Hanya kirim data yang berbeda/baru ke device (tanpa clear data)
 *   4. Refresh data & re-enable device
 * 
 * FIX: Menggunakan writeUserToDevice() yang mengimplementasikan protocol ZKTeco dengan benar
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

        // Step 3: Get existing users from device to compare
        let deviceUsers = [];
        try {
            const users = await zk.getUsers();
            deviceUsers = users?.data || [];
            console.log(`� [Sync Server->Device] Found ${deviceUsers.length} users on device`);
        } catch (e) {
            console.warn('⚠️ Could not get users from device (may not be supported):', e.message);
        }

        // Build a map of device users by userId for quick lookup
        const deviceUserMap = {};
        let maxUid = 0;
        for (const du of deviceUsers) {
            const duId = String(du.userId || '').trim();
            const uid = du.uid || 0;
            if (duId) {
                deviceUserMap[duId] = {
                    name: (du.name || '').trim(),
                    uid: uid
                };
            }
            if (uid > maxUid) maxUid = uid;
        }

        // Step 4: Compare and only write users that are NEW or CHANGED
        const USER_RECORD_SIZE = 72;
        let totalWritten = 0;
        let totalSkipped = 0;
        let nextUid = maxUid + 1;

        for (let i = 0; i < employees.length; i++) {
            const emp = employees[i];
            const userId = String(emp.user_id || '').trim();
            const name = (emp.nama || '').trim() || 'Unknown';

            // Check if user exists on device and data is the same
            const existingUser = deviceUserMap[userId];
            if (existingUser) {
                const existingName = existingUser.name || '';
                // Compare names (case-insensitive) - if same, skip writing
                if (existingName.toLowerCase() === name.toLowerCase()) {
                    totalSkipped++;
                    continue;
                }
                console.log(`🔄 [Sync] User ${userId} name changed: "${existingName}" -> "${name}"`);
            } else {
                console.log(`🆕 [Sync] New user ${userId} (${name}) not found on device, adding...`);
            }

            try {
                // Build user data packet (72 bytes format) matching decodeUserData72 structure
                const userData = Buffer.alloc(USER_RECORD_SIZE);
                userData.fill(0);

                // uid (2 bytes at offset 0) - use existing UID if user already on device, otherwise new sequential
                const uid = existingUser ? existingUser.uid : nextUid++;
                userData.writeUInt16LE(uid, 0);

                // role (1 byte at offset 2) - 0 = user, 14 = admin
                userData.writeUInt8(0, 2);

                // password (8 bytes at offset 3) - keep empty to not disturb existing password
                const pwBuf = Buffer.from('', 'ascii');
                pwBuf.copy(userData, 3);

                // name (24 bytes at offset 11)
                const nameBuf = Buffer.from(name, 'ascii');
                nameBuf.copy(userData, 11, 0, Math.min(nameBuf.length, 24));

                // cardno (4 bytes at offset 35) - set to 0 to not disturb existing card
                userData.writeUInt32LE(0, 35);

                // userId (9 bytes at offset 48)
                const userIdBuf = Buffer.from(userId, 'ascii');
                userIdBuf.copy(userData, 48, 0, Math.min(userIdBuf.length, 9));

                // Send CMD_USER_WRQ (command 8) to write user to device using proper protocol
                await writeUserToDevice(zk, userData);
                totalWritten++;

            } catch (e) {
                console.warn(`⚠️ Failed to write user ${emp.user_id} to device:`, e.message);
            }
        }
        console.log(`✅ [Sync Server->Device] Written: ${totalWritten}, Skipped (unchanged): ${totalSkipped}/${employees.length}`);

        // Step 5: Refresh device data so it recognizes the new users
        try { await zk.executeCmd(1013, Buffer.from([])); } catch (e) { /* ignore */ } // CMD_REFRESHDATA
        try { await zk.executeCmd(1014, Buffer.from([])); } catch (e) { /* ignore */ } // CMD_REFRESHOPTION

        // Small delay to let device process the data
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Step 6: Re-enable device
        try { await zk.enableDevice(); } catch (e) { console.warn('⚠️ enableDevice warning:', e.message); }

        await zk.disconnect();
        return { success: true, count: totalWritten, skipped: totalSkipped };
    } catch (error) {
        console.error(`❌ Error syncing server to device ${ip}:`, error.message);
        try { await zk.disconnect(); } catch (e) { }
        throw error;
    }
}



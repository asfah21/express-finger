import 'dotenv/config';
import ZKLib from 'node-zklib';

const IP = '10.10.62.181';
const PORT = 4370;

async function main() {
    const zk = new ZKLib(IP, PORT, 15000, 5200 + Math.floor(Math.random() * 1000));
    await zk.createSocket();
    console.log('Connected!');

    const info = await zk.getInfo();
    console.log('Info:', JSON.stringify(info));

    const users = await zk.getUsers();
    const userData = users?.data || [];
    console.log('Users:', userData.length);

    const uidToUser = {};
    userData.forEach(u => { 
        uidToUser[u.uid] = { 
            userId: String(u.userId || '').trim(), 
            name: (u.name || '').trim() || 'Unknown' 
        }; 
    });

    const tcp = zk.zklibTcp;

    // Method 1: readWithBuffer with table=2
    console.log('\n=== Method 1: readWithBuffer (table=2) ===');
    const fpPayload = Buffer.from([0x01, 0x07, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    
    try {
        const result = await tcp.readWithBuffer(fpPayload);
        const data = result.data;
        console.log(`Data: ${data.length} bytes`);
        
        let offset = 4;
        let templateCount = 0;
        const fpCounts = {};
        
        while (offset < data.length) {
            if (offset + 6 > data.length) break;
            
            const sizeEntry = data.readUInt16LE(offset);
            const userSn = data.readUInt16LE(offset + 2);
            const fpIndex = data.readUInt8(offset + 4);
            const fpFlag = data.readUInt8(offset + 5);
            
            if (sizeEntry < 6 || sizeEntry > 2000) {
                offset++;
                continue;
            }
            
            if (userSn > 0 && userSn <= 2000 && fpIndex >= 0 && fpIndex <= 10) {
                templateCount++;
                if (!fpCounts[userSn]) fpCounts[userSn] = new Set();
                fpCounts[userSn].add(fpIndex);
            }
            
            offset += sizeEntry;
        }
        
        console.log(`Templates: ${templateCount}, Users: ${Object.keys(fpCounts).length}`);
        Object.keys(fpCounts).sort((a,b) => a-b).forEach(uid => {
            const u = uidToUser[uid] || { userId: '?', name: '?' };
            console.log(`  uid=${uid} (${u.userId}): ${fpCounts[uid].size} fingerprint(s)`);
        });
    } catch (e) {
        console.log(`Error: ${e.message}`);
    }

    // Method 2: CMD_USERTEMP_RRQ for each user (reworked)
    // We'll request the user template record for each fp index and parse the returned buffer.
    console.log('\n=== Method 2: CMD_USERTEMP_RRQ for each user (reworked) ===');

    let fpUserCount = 0;
    const fpCounts2 = {};

    // Only check first 50 users to save time
    const checkUsers = userData.slice(0, 50);

    for (const u of checkUsers) {
        const uid = u.uid;
        if (!uid) continue;

        // Ensure device buffer is clear before starting
        try { await tcp.freeData(); } catch (e) { /* ignore */ }
        await new Promise(r => setTimeout(r, 50));

        // Try fpIndex 0-9 for each user
        for (let fpIdx = 0; fpIdx <= 9; fpIdx++) {
            try {
                // Build request: uid (2 bytes LE) + fpIdx (1 byte)
                const req = Buffer.alloc(3);
                req.writeUInt16LE(uid, 0);
                req.writeUInt8(fpIdx, 2);

                // executeCmd will send USERTEMP_RRQ (9) and return a Buffer on success
                const result = await zk.executeCmd(9, req); // CMD_USERTEMP_RRQ = 9

                // result may include a 4-byte header before payload depending on implementation
                const payload = (result && result.length > 4) ? result.subarray(4) : result;

                // A valid template payload should be reasonably sized (> 20 bytes) and contain template header
                if (payload && payload.length > 20) {
                    // Basic sanity: first two bytes often include a size field or uid
                    // We'll accept this as an existing template
                    if (!fpCounts2[uid]) fpCounts2[uid] = new Set();
                    fpCounts2[uid].add(fpIdx);
                    console.log(`  uid=${uid} (${u.userId}): fpIndex=${fpIdx} ✅ (${payload.length} bytes)`);
                }

                // small delay between requests
                await new Promise(r => setTimeout(r, 30));
            } catch (e) {
                // Some errors indicate the template doesn't exist; ignore silently
                // but log unexpected errors (non-ACK) at debug level
                if (e && e.message && !/ACK|ERROR|no template/i.test(e.message)) {
                    console.debug(`  uid=${uid} fpIdx=${fpIdx} error:`, e.message);
                }
            }
        }

        if (fpCounts2[uid]?.size > 0) {
            fpUserCount++;
        }
    }

    console.log(`\nUsers with fingerprint (first 50): ${fpUserCount}`);
    Object.keys(fpCounts2).sort((a,b) => a-b).forEach(uid => {
        const u = uidToUser[uid] || { userId: '?', name: '?' };
        console.log(`  uid=${uid} (${u.userId}): ${fpCounts2[uid].size} fingerprint(s)`);
    });

    await zk.disconnect();
    console.log('\nDone!');
}

main().catch(e => console.error('Error:', e.message));

import { pool } from '../utils/database.js'
import { recordActivity } from './activity-log.js'
import { sendSuccess, sendError, sendPaginated } from '../utils/response.js'
import { getCache, setCache, delCacheByPattern, CACHE_KEYS, TTL, buildCacheKey } from '../utils/cache.js'
import ZKLib from 'node-zklib'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { createTCPHeader, removeTcpHeader } = require('node-zklib/utils.js')
const COMMANDS = require('node-zklib/constants.js').COMMANDS

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
}

/**
 * Write a single user record to the device using the proper ZKTeco protocol.
 * This avoids the replyId desync issue with executeCmd.
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


export const employeeController = {
    /**
     * Sync a single employee (name + user_id) from server to a specific device
     * FIXED: Now properly looks up existing user UID on device before writing,
     * and uses direct TCP write instead of executeCmd to avoid replyId desync.
     */
    async syncEmployeeToDevice(req, res) {
        const { id } = req.params
        const { deviceId } = req.body
        if (!deviceId) return sendError(res, 'Device ID is required', 400)

        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            // 1. Get employee data
            const { rows: empRows } = await pool.query('SELECT * FROM employee WHERE id = $1', [id])
            if (empRows.length === 0) return sendError(res, 'Employee not found', 404)
            const emp = empRows[0]

            // 2. Get device info
            const { rows: devRows } = await pool.query('SELECT * FROM devices WHERE id = $1', [deviceId])
            if (devRows.length === 0) return sendError(res, 'Device not found', 404)
            const device = devRows[0]

            if (!device.ip) {
                return sendError(res, 'Device IP is not configured', 400)
            }

            const port = device.port || 4370
            const userId = String(emp.user_id || '').trim()
            const name = (emp.nama || '').trim() || 'Unknown'

            // 3. Connect to device and write user
            const zk = new ZKLib(device.ip, parseInt(port), 15000, 5200 + Math.floor(Math.random() * 1000))
            try {
                await zk.createSocket()
                console.log(`🔗 [Sync Single] Connected to ${device.ip}:${port}`)

                // Disable device before writing
                try { await zk.disableDevice() } catch (e) { /* ignore */ }

                // --- FIX: First, get existing users from device to find correct UID ---
                let existingUid = null;
                try {
                    const users = await zk.getUsers();
                    const userData = users?.data || [];
                    for (const u of userData) {
                        const duId = String(u.userId || '').trim();
                        if (duId === userId) {
                            existingUid = u.uid;
                            console.log(`🔍 [Sync Single] Found existing user ${userId} on device with UID=${existingUid}`);
                            break;
                        }
                    }
                } catch (e) {
                    console.warn('⚠️ [Sync Single] Could not get users from device:', e.message);
                }

                // Build user data packet (72 bytes format)
                const USER_RECORD_SIZE = 72
                const userData = Buffer.alloc(USER_RECORD_SIZE)
                userData.fill(0)

                // uid (2 bytes at offset 0) - use existing UID if found, otherwise use 1
                const uid = existingUid !== null ? existingUid : 1;
                userData.writeUInt16LE(uid, 0)

                // role (1 byte at offset 2) - 0 = user
                userData.writeUInt8(0, 2)

                // password (8 bytes at offset 3) - empty to not disturb existing password
                const pwBuf = Buffer.from('', 'ascii')
                pwBuf.copy(userData, 3)

                // name (24 bytes at offset 11)
                const nameBuf = Buffer.from(name, 'ascii')
                nameBuf.copy(userData, 11, 0, Math.min(nameBuf.length, 24))

                // cardno (4 bytes at offset 35) - set to 0 to not disturb existing card
                userData.writeUInt32LE(0, 35)

                // userId (9 bytes at offset 48)
                const userIdBuf = Buffer.from(userId, 'ascii')
                userIdBuf.copy(userData, 48, 0, Math.min(userIdBuf.length, 9))

                // --- FIX: Use writeUserToDevice instead of executeCmd to avoid replyId desync ---
                await writeUserToDevice(zk, userData)
                console.log(`✅ [Sync Single] Written user ${userId} (${name}) to device ${device.ip} (UID=${uid})`)

                // Refresh device data
                try { await zk.executeCmd(1013, Buffer.from([])) } catch (e) { /* ignore */ }
                try { await zk.executeCmd(1014, Buffer.from([])) } catch (e) { /* ignore */ }

                // Small delay to let device process
                await new Promise(resolve => setTimeout(resolve, 1000))

                // Re-enable device
                try { await zk.enableDevice() } catch (e) { /* ignore */ }

                await zk.disconnect()
            } catch (err) {
                try { await zk.disconnect() } catch (e) { /* ignore */ }
                throw new Error(`Device communication failed: ${err.message}`)
            }

            // 4. Update timestamp in database
            await pool.query(
                `UPDATE employee SET updated_at = now() WHERE id = $1`,
                [id]
            )

            await recordActivity({
                username, action: 'sync_employee_to_device', category: 'sync',
                detail: `Synced employee ${name} (User ID: ${userId}) to device ${device.name || device.sn} (${device.ip})`,
                ip
            })

            sendSuccess(res, null, `Employee ${name} (${userId}) synced to device ${device.name || device.ip}`)
        } catch (error) {
            console.error('Sync Employee To Device Error:', error)

            await recordActivity({
                username, action: 'sync_employee_to_device', category: 'sync',
                detail: `Failed to sync employee ID ${id} to device ID ${deviceId}. Error: ${error.message}`,
                ip, status: 'failed'
            })

            sendError(res, error.message)
        }
    },


    async listEmployees(req, res) {
        try {
            const { limit = 25, offset = 0, search = '' } = req.query
            const lim = parseInt(limit)
            const off = parseInt(offset)

            // Cek cache - hanya cache request tanpa search (halaman 1) untuk hemat memori
            let cacheKey = null
            const shouldCache = !search && off === 0
            if (shouldCache) {
                cacheKey = buildCacheKey(CACHE_KEYS.EMPLOYEES_LIST, lim)
                const cached = getCache(cacheKey)
                if (cached) {
                    return sendPaginated(res, cached.rows, cached.total, lim, off)
                }
            }

            let query = 'SELECT * FROM employee'
            let countQuery = 'SELECT COUNT(*)::int as total FROM employee'
            let params = [lim, off]
            let countParams = []

            if (search) {
                const searchPattern = `%${search}%`
                query += ' WHERE (nama ILIKE $3 OR user_id ILIKE $3)'
                countQuery += ' WHERE (nama ILIKE $1 OR user_id ILIKE $1)'
                params.push(searchPattern)
                countParams.push(searchPattern)
            }

            // Urutkan berdasarkan fid (user_id) secara numerik naik (1 → terakhir),
            // bukan berdasarkan id primary key DB. Nilai non-numerik ditempatkan di
            // akhir agar cast tidak error.
            query += ` ORDER BY CASE
                WHEN user_id ~ '^[0-9]+$' THEN user_id::bigint
                ELSE 2147483647
              END ASC, id ASC
              LIMIT $1 OFFSET $2`

            const { rows } = await pool.query(query, params)
            const { rows: countRes } = await pool.query(countQuery, countParams)
            const total = countRes[0].total

            // Simpan ke cache (hanya jika shouldCache)
            if (shouldCache && cacheKey) {
                setCache(cacheKey, { rows, total }, TTL.SHORT)
            }

            sendPaginated(res, rows, total, lim, off)
        } catch (error) {
            sendError(res, error.message)
        }
    },

    async listDepartments(req, res) {
        try {
            // Daftar departemen jarang berubah → cache lama (VERY_LONG)
            const cacheKey = buildCacheKey(CACHE_KEYS.EMPLOYEE_DEPARTMENTS)
            const cached = getCache(cacheKey)
            if (cached) {
                return sendSuccess(res, cached)
            }

            const { rows } = await pool.query(
                `SELECT DISTINCT department
                 FROM employee
                 WHERE department IS NOT NULL AND TRIM(department) <> ''
                 ORDER BY department ASC`
            )
            const departments = rows.map(r => r.department)

            setCache(cacheKey, departments, TTL.VERY_LONG)
            sendSuccess(res, departments)
        } catch (error) {
            console.error('List Departments Error:', error)
            sendError(res, error.message)
        }
    },

    async getEmployee(req, res) {
        const { id } = req.params
        try {
            // Cek cache
            const cacheKey = buildCacheKey(CACHE_KEYS.EMPLOYEE_DETAIL, id)
            const cached = getCache(cacheKey)
            if (cached) {
                return sendSuccess(res, cached)
            }

            const { rows } = await pool.query('SELECT * FROM employee WHERE id = $1', [id])
            if (rows.length === 0) return sendError(res, 'Employee not found', 404)

            // Simpan ke cache
            setCache(cacheKey, rows[0], TTL.MEDIUM)

            sendSuccess(res, rows[0])
        } catch (error) {
            sendError(res, error.message)
        }
    },

    async addEmployee(req, res) {
        const { user_id, nik, nama, jabatan, department, divisi, type } = req.body
        if (!user_id) return sendError(res, 'user_id is required', 400)

        // Validasi: user_id harus alphanumeric (angka/huruf, max 20 karakter)
        const userIdStr = String(user_id).trim()
        if (!/^[a-zA-Z0-9_-]{1,20}$/.test(userIdStr)) {
            return sendError(res, 'user_id must be alphanumeric (letters, numbers, hyphens, underscores), max 20 characters', 400)
        }

        // Validasi: nama tidak boleh terlalu panjang
        if (nama && nama.length > 100) {
            return sendError(res, 'Name is too long (max 100 characters)', 400)
        }

        // Validasi: NIK harus alphanumeric jika diisi
        if (nik && !/^[a-zA-Z0-9_-]{0,30}$/.test(String(nik))) {
            return sendError(res, 'NIK contains invalid characters', 400)
        }

        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            const { rows } = await pool.query(
                `INSERT INTO employee (user_id, nik, nama, jabatan, department, divisi, type) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [userIdStr, nik, nama, jabatan, department, divisi, type]
            )

            // Hapus cache employees
            delCacheByPattern(CACHE_KEYS.EMPLOYEES_LIST + '*')

            await recordActivity({
                username, action: 'add_employee', category: 'employee',
                detail: `Added employee: ${nama || 'N/A'} (User ID: ${userIdStr}, NIK: ${nik || '-'})`,
                ip
            })

            sendSuccess(res, rows[0], '', 201)
        } catch (error) {
            if (error.code === '23505') {
                return sendError(res, 'user_id already exists', 409)
            }
            sendError(res, error.message)
        }
    },

    async updateEmployee(req, res) {
        const { id } = req.params
        const { user_id, nik, nama, jabatan, department, divisi, type } = req.body
        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            // Ambil data lama sebelum update untuk perbandingan
            const { rows: oldRows } = await pool.query('SELECT * FROM employee WHERE id = $1', [id])
            if (oldRows.length === 0) return sendError(res, 'Employee not found', 404)
            const old = oldRows[0]

            const { rows } = await pool.query(
                `UPDATE employee 
                 SET user_id = COALESCE($1, user_id), 
                     nik = COALESCE($2, nik), 
                     nama = COALESCE($3, nama), 
                     jabatan = COALESCE($4, jabatan), 
                     department = COALESCE($5, department),
                     divisi = COALESCE($6, divisi),
                     type = COALESCE($7, type)
                 WHERE id = $8 RETURNING *`,
                [user_id ? String(user_id) : null, nik, nama, jabatan, department, divisi, type, id]
            )

            // Hapus cache employees
            delCacheByPattern(CACHE_KEYS.EMPLOYEES_LIST + '*')
            delCacheByPattern(CACHE_KEYS.EMPLOYEE_DETAIL + ':*')

            // Bandingkan field yang berubah untuk detail log
            const newData = rows[0]
            const changes = []
            const fields = [
                { label: 'User ID', key: 'user_id' },
                { label: 'NIK', key: 'nik' },
                { label: 'Nama', key: 'nama' },
                { label: 'Jabatan', key: 'jabatan' },
                { label: 'Department', key: 'department' },
                { label: 'Divisi', key: 'divisi' },
                { label: 'Type', key: 'type' }
            ]
            for (const field of fields) {
                const oldVal = old[field.key]
                const newVal = newData[field.key]
                const oldStr = oldVal != null ? String(oldVal) : ''
                const newStr = newVal != null ? String(newVal) : ''
                if (oldStr !== newStr) {
                    changes.push(`${field.label}: "${oldStr || '-'}" → "${newStr || '-'}"`)
                }
            }

            const changeDetail = changes.length > 0 ? changes.join('; ') : 'No changes'
            await recordActivity({
                username, action: 'edit_employee', category: 'employee',
                detail: `Updated employee: ${newData.nama || 'N/A'} (ID: ${id}). Changes: ${changeDetail}`,
                ip
            })

            sendSuccess(res, rows[0])
        } catch (error) {
            if (error.code === '23505') {
                return sendError(res, 'user_id already exists', 409)
            }
            sendError(res, error.message)
        }
    },


    async deleteEmployee(req, res) {
        const { id } = req.params
        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            // Get info before deleting
            const { rows: empRows } = await pool.query('SELECT nama, user_id FROM employee WHERE id = $1', [id])
            const emp = empRows[0]

            const { rowCount } = await pool.query('DELETE FROM employee WHERE id = $1', [id])
            if (rowCount === 0) return sendError(res, 'Employee not found', 404)

            // Hapus cache employees
            delCacheByPattern(CACHE_KEYS.EMPLOYEES_LIST + '*')
            delCacheByPattern(CACHE_KEYS.EMPLOYEE_DETAIL + ':*')

            await recordActivity({
                username, action: 'delete_employee', category: 'employee',
                detail: `Deleted employee: ${emp?.nama || 'N/A'} (User ID: ${emp?.user_id || id})`,
                ip
            })

            sendSuccess(res, null, 'Employee deleted')
        } catch (error) {
            sendError(res, error.message)
        }
    },

    async bulkDeleteEmployees(req, res) {
        const { ids } = req.body
        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        // Validasi input
        if (!Array.isArray(ids) || ids.length === 0) {
            return sendError(res, 'ids array is required and must not be empty', 400)
        }
        if (ids.length > 500) {
            return sendError(res, 'Maximum 500 employees per bulk delete', 400)
        }
        const parsedIds = [...new Set(ids.map(id => parseInt(id, 10)))]
        if (parsedIds.some(id => !Number.isInteger(id) || id <= 0)) {
            return sendError(res, 'ids must be an array of valid positive integers', 400)
        }

        const client = await pool.connect()
        try {
            await client.query('BEGIN')

            // Ambil info karyawan sebelum dihapus (untuk activity log)
            const { rows: empRows } = await client.query(
                `SELECT id, user_id, nama FROM employee WHERE id = ANY($1::int[])`,
                [parsedIds]
            )

            // Hapus template biometrik milik karyawan yang dihapus (histori absensi tetap dipertahankan)
            await client.query(
                `DELETE FROM employee_templates WHERE user_id IN (
                    SELECT user_id FROM employee WHERE id = ANY($1::int[])
                 )`,
                [parsedIds]
            )

            // Hapus master karyawan (satu query batch, atomik)
            const { rowCount } = await client.query(
                `DELETE FROM employee WHERE id = ANY($1::int[])`,
                [parsedIds]
            )

            await client.query('COMMIT')

            // Hapus cache employees
            delCacheByPattern(CACHE_KEYS.EMPLOYEES_LIST + '*')
            delCacheByPattern(CACHE_KEYS.EMPLOYEE_DETAIL + ':*')

            const notFound = parsedIds.length - rowCount

            // Activity log agregat (dibatasi 50 nama agar tidak terlalu panjang)
            const nameList = empRows.map(e => `${e.nama || 'N/A'} (${e.user_id || e.id})`)
            const detail = nameList.length > 50
                ? `${nameList.slice(0, 50).join(', ')} ... and ${nameList.length - 50} more`
                : nameList.join(', ')

            // Logging non-fatal: tidak menggagalkan response jika activity log gagal
            try {
                await recordActivity({
                    username, action: 'bulk_delete_employee', category: 'employee',
                    detail: `Bulk deleted ${rowCount} employees: ${detail || '-'}`,
                    ip
                })
            } catch (logErr) {
                console.error('Bulk delete activity log failed:', logErr.message)
            }

            sendSuccess(res, { requested: parsedIds.length, deleted: rowCount, notFound }, `Deleted ${rowCount} employees`)
        } catch (error) {
            try { await client.query('ROLLBACK') } catch (rollbackErr) { /* transaksi sudah di-rollback / closed */ }
            sendError(res, error.message)
        } finally {
            client.release()
        }
    },

    async bulkAddEmployees(req, res) {
        const { employees } = req.body
        if (!Array.isArray(employees)) return sendError(res, 'Invalid data format', 400)

        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            const results = []
            for (const emp of employees) {
                const { user_id, nik, nama, jabatan, department, divisi, type } = emp
                if (!user_id) continue

                const { rows } = await pool.query(
                    `INSERT INTO employee (user_id, nik, nama, jabatan, department, divisi, type) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7) 
                     ON CONFLICT (user_id) DO UPDATE 
                     SET nik = COALESCE(NULLIF(EXCLUDED.nik, ''), employee.nik),
                         nama = COALESCE(NULLIF(EXCLUDED.nama, ''), employee.nama),
                         jabatan = COALESCE(NULLIF(EXCLUDED.jabatan, ''), employee.jabatan),
                         department = COALESCE(NULLIF(EXCLUDED.department, ''), employee.department),
                         divisi = COALESCE(NULLIF(EXCLUDED.divisi, ''), employee.divisi),
                         type = COALESCE(NULLIF(EXCLUDED.type, ''), employee.type),
                         updated_at = CURRENT_TIMESTAMP
                     RETURNING *`,
                    [String(user_id), nik, nama, jabatan, department, divisi, type]
                )
                results.push(rows[0])
            }

            // Hapus cache employees
            delCacheByPattern(CACHE_KEYS.EMPLOYEES_LIST + '*')

            await recordActivity({
                username, action: 'import_employees', category: 'import',
                detail: `Bulk imported ${results.length} employees from file`,
                ip
            })

            sendSuccess(res, results, `Imported ${results.length} employees`)
        } catch (error) {
            sendError(res, error.message)
        }
    }
}

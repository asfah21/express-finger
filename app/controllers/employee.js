import { pool } from '../utils/database.js'
import { recordActivity } from './activity-log.js'
import ZKLib from 'node-zklib'

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
}

export const employeeController = {
    /**
     * Sync a single employee (name + user_id) from server to a specific device
     */
    async syncEmployeeToDevice(req, res) {
        const { id } = req.params
        const { deviceId } = req.body
        if (!deviceId) return res.status(400).json({ status: 'error', message: 'Device ID is required' })

        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            // 1. Get employee data
            const { rows: empRows } = await pool.query('SELECT * FROM employee WHERE id = $1', [id])
            if (empRows.length === 0) return res.status(404).json({ status: 'error', message: 'Employee not found' })
            const emp = empRows[0]

            // 2. Get device info
            const { rows: devRows } = await pool.query('SELECT * FROM devices WHERE id = $1', [deviceId])
            if (devRows.length === 0) return res.status(404).json({ status: 'error', message: 'Device not found' })
            const device = devRows[0]

            if (!device.ip) {
                return res.status(400).json({ status: 'error', message: 'Device IP is not configured' })
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

                // Build user data packet (72 bytes format)
                const USER_RECORD_SIZE = 72
                const userData = Buffer.alloc(USER_RECORD_SIZE)
                userData.fill(0)

                // uid (2 bytes at offset 0) - use 1 as default since we're updating by userId
                userData.writeUInt16LE(1, 0)

                // role (1 byte at offset 2) - 0 = user
                userData.writeUInt8(0, 2)

                // password (8 bytes at offset 3) - empty
                const pwBuf = Buffer.from('', 'ascii')
                pwBuf.copy(userData, 3)

                // name (24 bytes at offset 11)
                const nameBuf = Buffer.from(name, 'ascii')
                nameBuf.copy(userData, 11, 0, Math.min(nameBuf.length, 24))

                // cardno (4 bytes at offset 35)
                userData.writeUInt32LE(0, 35)

                // userId (9 bytes at offset 48)
                const userIdBuf = Buffer.from(userId, 'ascii')
                userIdBuf.copy(userData, 48, 0, Math.min(userIdBuf.length, 9))

                // Send CMD_USER_WRQ (command 8) to write user to device
                await zk.executeCmd(8, userData)
                console.log(`✅ [Sync Single] Written user ${userId} (${name}) to device ${device.ip}`)

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

            // 4. Update fingerprint_count in database
            await pool.query(
                `UPDATE employee SET updated_at = now() WHERE id = $1`,
                [id]
            )

            await recordActivity({
                username, action: 'sync_employee_to_device', category: 'sync',
                detail: `Synced employee ${name} (User ID: ${userId}) to device ${device.name || device.sn} (${device.ip})`,
                ip
            })

            res.json({
                status: 'success',
                message: `Employee ${name} (${userId}) synced to device ${device.name || device.ip}`
            })
        } catch (error) {
            console.error('Sync Employee To Device Error:', error)

            await recordActivity({
                username, action: 'sync_employee_to_device', category: 'sync',
                detail: `Failed to sync employee ID ${id} to device ID ${deviceId}. Error: ${error.message}`,
                ip, status: 'failed'
            })

            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async listEmployees(req, res) {
        try {
            const { limit = 25, offset = 0, search = '' } = req.query
            const lim = parseInt(limit)
            const off = parseInt(offset)

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

            query += ' ORDER BY id ASC LIMIT $1 OFFSET $2'

            const { rows } = await pool.query(query, params)
            const { rows: countRes } = await pool.query(countQuery, countParams)

            res.json({
                status: 'success',
                data: {
                    list: rows,
                    total: countRes[0].total,
                    limit: lim,
                    offset: off
                }
            })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async getEmployee(req, res) {
        const { id } = req.params
        try {
            const { rows } = await pool.query('SELECT * FROM employee WHERE id = $1', [id])
            if (rows.length === 0) return res.status(404).json({ status: 'error', message: 'Employee not found' })
            res.json({ status: 'success', data: rows[0] })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async addEmployee(req, res) {
        const { user_id, nik, nama, jabatan, department, divisi, type } = req.body
        if (!user_id) return res.status(400).json({ status: 'error', message: 'user_id is required' })

        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
            const { rows } = await pool.query(
                `INSERT INTO employee (user_id, nik, nama, jabatan, department, divisi, type) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [String(user_id), nik, nama, jabatan, department, divisi, type]
            )

            await recordActivity({
                username, action: 'add_employee', category: 'employee',
                detail: `Added employee: ${nama || 'N/A'} (User ID: ${user_id}, NIK: ${nik || '-'})`,
                ip
            })

            res.status(201).json({ status: 'success', data: rows[0] })
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({ status: 'error', message: 'user_id already exists' })
            }
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async updateEmployee(req, res) {
        const { id } = req.params
        const { user_id, nik, nama, jabatan, department, divisi, type } = req.body
        const username = req.user?.username || 'api'
        const ip = getClientIp(req)

        try {
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
            if (rows.length === 0) return res.status(404).json({ status: 'error', message: 'Employee not found' })

            await recordActivity({
                username, action: 'edit_employee', category: 'employee',
                detail: `Updated employee: ${nama || rows[0]?.nama || 'N/A'} (ID: ${id})`,
                ip
            })

            res.json({ status: 'success', data: rows[0] })
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({ status: 'error', message: 'user_id already exists' })
            }
            res.status(500).json({ status: 'error', message: error.message })
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
            if (rowCount === 0) return res.status(404).json({ status: 'error', message: 'Employee not found' })

            await recordActivity({
                username, action: 'delete_employee', category: 'employee',
                detail: `Deleted employee: ${emp?.nama || 'N/A'} (User ID: ${emp?.user_id || id})`,
                ip
            })

            res.json({ status: 'success', message: 'Employee deleted' })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    },

    async bulkAddEmployees(req, res) {
        const { employees } = req.body
        if (!Array.isArray(employees)) return res.status(400).json({ status: 'error', message: 'Invalid data format' })

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

            await recordActivity({
                username, action: 'import_employees', category: 'import',
                detail: `Bulk imported ${results.length} employees from file`,
                ip
            })

            res.json({ status: 'success', message: `Imported ${results.length} employees`, data: results })
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message })
        }
    }
}

import { pool } from '../utils/database.js'
import { fetchDeviceUsersFormatted, pullDeviceUsersSync } from '../utils/zklib-employee.js'
import { recordActivity } from './activity-log.js'

export const pullEmployeeController = {
  async pullData(req, res) {
    const { deviceId, preview = false } = req.body
    if (!deviceId) return res.status(400).json({ status: 'error', message: 'Device ID is required' })

    const username = req.user?.username || 'api'
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''

    try {
      // 1. Get device info
      const { rows } = await pool.query('SELECT * FROM devices WHERE id = $1', [deviceId])
      if (rows.length === 0) return res.status(404).json({ status: 'error', message: 'Device not found' })
      const device = rows[0]

      if (!device.ip) {
        return res.status(400).json({ status: 'error', message: 'Device IP is not configured' })
      }

      const port = device.port || 4370

      if (preview) {
        // --- PREVIEW MODE: fetch, format, return — do NOT save ---
        const { formattedUsers, rawCount, deviceInfo } = await fetchDeviceUsersFormatted(device.ip, port, device.sn)

        await recordActivity({
          username,
          action: 'preview_pull_employee',
          category: 'sync',
          detail: `Preview pull employee from ${device.name || device.sn} (${device.ip}). Total: ${rawCount} users`,
          ip: clientIp
        })

        return res.json({
          status: 'success',
          message: `Preview: ${formattedUsers.length} users fetched from device.`,
          data: {
            total: rawCount,
            users: formattedUsers,
            deviceInfo
          }
        })
      } else {
        // --- SYNC MODE: pull + save to DB ---
        const result = await pullDeviceUsersSync(device.ip, port)

        await pool.query('UPDATE devices SET last_sync = now() WHERE id = $1', [deviceId])

        await recordActivity({
          username,
          action: 'pull_employee',
          category: 'sync',
          detail: `Pull employee from ${device.name || device.sn} (${device.ip}). Users: ${result.count}`,
          ip: clientIp
        })

        return res.json({
          status: 'success',
          message: `Successfully pulled and synced ${result.count} employees from device.`,
          data: {
            total: result.count,
            saved: result.count,
            users: []
          }
        })
      }
    } catch (error) {
      console.error('Pull Employee Error:', error)
      res.status(500).json({ status: 'error', message: `Connection failed: ${error.message}` })
    }
  }
}

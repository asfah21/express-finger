import { pool } from '../utils/database.js'
import { fetchDeviceUsersFormatted, pullDeviceUsersSync, syncServerToDevice } from '../utils/zklib-employee.js'
import { recordActivity } from './activity-log.js'

export const pullEmployeeController = {
  async pullData(req, res) {
    const { deviceId, preview = false, syncMode = 'device-to-server' } = req.body
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
        // --- SYNC MODE ---
        if (syncMode === 'device-to-server') {
          // Sync from Device -> Server
          const result = await pullDeviceUsersSync(device.ip, port)

          await pool.query('UPDATE devices SET last_sync = now() WHERE id = $1', [deviceId])

          await recordActivity({
            username,
            action: 'pull_employee',
            category: 'sync',
            detail: `Sync Device->Server: Pull employee from ${device.name || device.sn} (${device.ip}). Written: ${result.count}, Skipped (unchanged): ${result.skipped || 0}`,
            ip: clientIp
          })

          return res.json({
            status: 'success',
            message: `Synced ${result.count} employees from device. ${result.skipped || 0} unchanged (skipped).`,
            data: {
              total: result.count,
              saved: result.count,
              skipped: result.skipped || 0,
              users: []
            }
          })
        } else if (syncMode === 'server-to-device') {
          // Sync from Server -> Device
          const result = await syncServerToDevice(device.ip, port)

          await pool.query('UPDATE devices SET last_sync = now() WHERE id = $1', [deviceId])

          await recordActivity({
            username,
            action: 'push_employee',
            category: 'sync',
            detail: `Sync Server->Device: Push employee to ${device.name || device.sn} (${device.ip}). Written: ${result.count}, Skipped (unchanged): ${result.skipped || 0}`,
            ip: clientIp
          })

          return res.json({
            status: 'success',
            message: `Synced ${result.count} employees to device. ${result.skipped || 0} unchanged (skipped).`,
            data: {
              total: result.count,
              saved: result.count,
              skipped: result.skipped || 0,
              users: []
            }
          })
        } else {
          return res.status(400).json({ status: 'error', message: 'Invalid sync mode. Use "device-to-server" or "server-to-device"' })
        }
      }
    } catch (error) {
      console.error('Pull Employee Error:', error)

      // Catat kegagalan ke activity log
      await recordActivity({
        username,
        action: syncMode === 'server-to-device' ? 'push_employee' : (preview ? 'preview_pull_employee' : 'pull_employee'),
        category: 'sync',
        detail: `Failed: ${syncMode === 'server-to-device' ? 'Push employee to' : (preview ? 'Preview pull employee from' : 'Pull employee from')} ${device?.name || device?.sn || 'unknown'} (${device?.ip || 'unknown'}). Error: ${error.message}`,
        ip: clientIp,
        status: 'failed'
      })

      res.status(500).json({ status: 'error', message: `Connection failed: ${error.message}` })
    }
  }
}

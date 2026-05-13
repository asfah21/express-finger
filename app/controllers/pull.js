import { pool, saveManyLogs } from '../utils/database.js'
import { pullDeviceLogs, fetchDeviceLogsFormatted, clearDeviceLogs } from '../utils/zklib.js'
import { recordActivity } from './activity-log.js'

export const pullController = {
  async pullData(req, res) {
    const { deviceId, preview = false, clearAfterSync = false } = req.body
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
        const { formattedLogs, rawCount } = await fetchDeviceLogsFormatted(device.ip, port, device.sn)

        await recordActivity({
          username,
          action: 'preview_pull_data',
          category: 'sync',
          detail: `Preview pull from ${device.name || device.sn} (${device.ip}). Raw: ${rawCount}, After filter: ${formattedLogs.length}`,
          ip: clientIp
        })

        return res.json({
          status: 'success',
          message: `Preview: ${formattedLogs.length} logs fetched (${rawCount} raw from device).`,
          data: {
            total: rawCount,
            filtered: formattedLogs.length,
            saved: 0,
            logs: formattedLogs
          }
        })
      } else {
        // --- SYNC MODE: pull + save to DB ---
        const result = await pullDeviceLogs(device.ip, port, device.sn)

        await pool.query('UPDATE devices SET last_sync = now() WHERE id = $1', [deviceId])

        let cleared = false
        let clearError = null
        if (clearAfterSync) {
          try {
            await clearDeviceLogs(device.ip, port)
            cleared = true
          } catch (e) {
            clearError = e.message
          }
        }

        await recordActivity({
          username,
          action: 'pull_data',
          category: 'sync',
          detail: `Force pull from ${device.name || device.sn} (${device.ip}). Logs: ${result.count}. Cleared: ${cleared}`,
          ip: clientIp
        })

        return res.json({
          status: 'success',
          message: `Successfully pulled and synced ${result.count} logs from device.${cleared ? ' Device log cleared.' : ''}${clearError ? ` Warning: clear failed: ${clearError}` : ''}`,
          data: {
            total: result.count,
            saved: result.count,
            cleared,
            clearError,
            logs: []
          }
        })
      }
    } catch (error) {
      console.error('Pull Data Error:', error)
      res.status(500).json({ status: 'error', message: `Connection failed: ${error.message}` })
    }
  }
}

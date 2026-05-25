import { pool, saveManyLogs } from '../utils/database.js'
import { pullDeviceLogs, fetchDeviceLogsFormatted, clearDeviceLogs } from '../utils/zklib.js'
import { recordActivity } from './activity-log.js'
import { delCacheByPatterns, CACHE_PATTERNS } from '../utils/cache.js'


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

        // Fetch employee names to enrich logs
        const { rows: employees } = await pool.query('SELECT user_id, nama FROM employee')
        const employeeMap = employees.reduce((acc, emp) => {
          acc[emp.user_id] = emp.nama
          return acc
        }, {})

        const logsWithName = formattedLogs.map(log => ({
          ...log,
          name: employeeMap[log.userId] || 'Unknown'
        }))

        await recordActivity({
          username,
          action: 'preview_pull_data',
          category: 'sync',
          detail: `Preview pull from ${device.name || device.sn} (${device.ip}). Raw: ${rawCount}, After filter: ${logsWithName.length}`,
          ip: clientIp
        })

        return res.json({
          status: 'success',
          message: `Preview: ${logsWithName.length} logs fetched (${rawCount} raw from device).`,
          data: {
            total: rawCount,
            filtered: logsWithName.length,
            saved: 0,
            logs: logsWithName
          }
        })
      } else {
        // --- SYNC MODE: pull + save to DB ---
        const result = await pullDeviceLogs(device.ip, port, device.sn)

        await pool.query('UPDATE devices SET last_sync = now() WHERE id = $1', [deviceId])

        // Invalidate cache attendance karena ada data baru
        const deleted = delCacheByPatterns(CACHE_PATTERNS.ATTENDANCE)
        if (deleted > 0) {
          console.log(`🧹 Invalidated ${deleted} attendance cache keys after pull from ${device.ip}`)
        }


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

      // Determine if it was preview mode from the original request body
      const wasPreview = req.body?.preview === true || req.body?.preview === 'true'

      // Catat kegagalan ke activity log
      await recordActivity({
        username,
        action: wasPreview ? 'preview_pull_data' : 'pull_data',
        category: 'sync',
        detail: `Failed: ${wasPreview ? 'Preview pull from' : 'Force pull from'} ${device?.name || device?.sn || 'unknown'} (${device?.ip || 'unknown'}). Error: ${error.message}`,
        ip: clientIp,
        status: 'failed'
      })

      res.status(500).json({ status: 'error', message: `Connection failed: ${error.message}` })
    }
  }
}

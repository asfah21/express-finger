import ZKLib from 'node-zklib'
import { pool } from '../utils/database.js'
import { saveManyLogs } from '../utils/database.js'
import { recordActivity } from './activity-log.js'

export const pullController = {
  async pullData(req, res) {
    const { deviceId, preview = false } = req.body
    if (!deviceId) return res.status(400).json({ status: 'error', message: 'Device ID is required' })

    const username = req.user?.username || 'api'
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''

    let zk = null;
    try {
      // 1. Get device info
      const { rows } = await pool.query('SELECT * FROM devices WHERE id = $1', [deviceId])
      if (rows.length === 0) return res.status(404).json({ status: 'error', message: 'Device not found' })
      const device = rows[0]

      if (!device.ip) {
        return res.status(400).json({ status: 'error', message: 'Device IP is not configured' })
      }

      // 2. Connect to device
      zk = new ZKLib(device.ip, device.port || 4370, 10000, 4000)
      await zk.createSocket()

      // 3. Get attendances
      const attendances = await zk.getAttendances()
      const data = attendances?.data || []

      // 4. Transform data
      // node-zklib returns: { uid, id, state, timestamp, deviceDotProp }
      const formattedLogs = data.map(log => {
        // node-zklib fields can vary by version: recordTime or timestamp
        let ts = log.recordTime || log.timestamp;
        const dt = new Date(ts);
        const isoTs = isNaN(dt.getTime()) ? ts : dt.toISOString();

        // status or state
        const type = Number(log.status ?? log.state ?? 0);

        return {
          uid: log.userSn || log.uid,
          userId: String(log.deviceUserId || log.id || log.userId).trim(),
          timestamp: isoTs,
          type: type,
          absensi: type === 0 ? 'Masuk' : 'Pulang'
        };
      })

      let totalSaved = 0
      if (!preview && formattedLogs.length > 0) {
        totalSaved = await saveManyLogs(formattedLogs, device.sn)
        // 5. Update last_sync only if not preview
        await pool.query('UPDATE devices SET last_sync = now() WHERE id = $1', [deviceId])
      }

      // 6. Record activity
      await recordActivity({
        username,
        action: preview ? 'preview_pull_data' : 'pull_data',
        category: 'sync',
        detail: `${preview ? 'Preview' : 'Force pull'} data from ${device.name || device.sn} (${device.ip}). Total logs: ${data.length}`,
        ip: clientIp
      })

      if (zk) {
        await zk.disconnect().catch(err => console.error("Error disconnecting from ZK:", err.message));
      }

      res.json({
        status: 'success',
        message: preview ? `Successfully fetched ${data.length} logs for preview.` : `Successfully pulled ${data.length} logs from device.`,
        data: {
          total: data.length,
          saved: totalSaved,
          logs: preview ? formattedLogs : []
        }
      })
    } catch (error) {
      console.error('Pull Data Error:', error)
      if (zk) {
         await zk.disconnect().catch(err => console.error("Error disconnecting from ZK:", err.message));
      }
      res.status(500).json({ status: 'error', message: `Connection failed: ${error.message}` })
    }
  }
}

import ZKLib from 'node-zklib'
import { pool } from '../utils/database.js'
import { saveManyLogs } from '../utils/database.js'
import { recordActivity } from './activity-log.js'
import { SYNC_CONFIG } from '../config/sync.js'

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
      const formattedLogs = data.map(log => {
        // node-zklib fields can vary by version: recordTime or timestamp
        let ts = log.recordTime || log.timestamp;
        let dt = new Date(ts);
        
        // --- KOREKSI TANGGAL (FIX BIT-SHIFT FW 8.X) ---
        let year = dt.getFullYear();
        let month = dt.getMonth(); // 0-indexed
        if (year === 2025 && month === 9) {
             dt = new Date(2026, 1, dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds());
        }
        
        const isoTs = isNaN(dt.getTime()) ? ts : dt.toISOString();

        /**
         * Mapping Status (verifyState):
         * 0 = Check In (Masuk)
         * 1 = Check Out (Pulang)
         */
        const type = Number(log.verifyState ?? log.status ?? log.state ?? 0);
        
        let absensiDesc = type === 1 ? 'Pulang' : 'Masuk';
        
        // Smart Fallback: Jika mesin merekam semua sebagai 0 (tidak tekan tombol In/Out)
        // Kita anggap log di atas jam 13:00 sebagai Pulang.
        if (type === 0 && dt.getHours() >= 13) {
            absensiDesc = 'Pulang (Estimasi)';
        }

        return {
          uid: log.userSn || log.uid,
          userId: String(log.deviceUserId || log.id || log.userId).trim(),
          timestamp: isoTs,
          type: type,
          absensi: absensiDesc,
          rawType: type
        };
      }).filter(log => {
        // Filter future dates (corruption protection)
        if (!log.timestamp || isNaN(new Date(log.timestamp).getTime())) return true;
        const limit = new Date();
        limit.setDate(limit.getDate() + (SYNC_CONFIG.MAX_FUTURE_DAYS || 1));
        return new Date(log.timestamp) <= limit;
      });

      // Sort newest first by timestamp
      formattedLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

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

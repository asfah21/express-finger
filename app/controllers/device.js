import { mkdir, writeFile } from 'fs/promises'
import { config } from '../config/index.js'
import { smartParseMany, saveManyLogs, ensureRawDir, upsertDevice } from '../utils/index.js'
import { delCacheByPatterns, CACHE_PATTERNS } from '../utils/cache.js'
import { attendanceBus } from '../utils/events.js'

// Simple memory cache to reduce DB load
const lastDeviceIPs = new Map()

// Device controller
export const deviceController = {
  async handleCdata(req, res) {
    const deviceIP = req.ip.includes('::ffff:') ? req.ip.split('::ffff:')[1] : req.ip;
    let deviceSN = 'unknown';

    try {
      // 1. Ambil SN dari Query String
      const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
      deviceSN = url.searchParams.get('SN') || 'unknown';

      // 2. Registrasi/Update Device (hanya jika IP berubah)
      if (deviceSN !== 'unknown') {
        if (lastDeviceIPs.get(deviceSN) !== deviceIP) {
          await upsertDevice(deviceSN, deviceIP);
          lastDeviceIPs.set(deviceSN, deviceIP);
        }
      }

      // 3. Simpan Raw Log (Race-condition proof using SN + Timestamp + Random)
      const rawPayload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (rawPayload && rawPayload.length > 0) {
        const fileName = `push-${deviceSN}-${Date.now()}-${Math.floor(Math.random() * 1000)}.txt`;
        const filePath = `${config.RAW_DIR}/${fileName}`;

        // Non-blocking write
        writeFile(filePath, rawPayload).catch(e => console.error(`❌ Disk Error (${deviceSN}):`, e.message));
      }

      // 4. Parse & Save to DB
      const rows = smartParseMany(req);
      if (rows.length > 0) {
        // saveManyLogs sudah memiliki proteksi ON CONFLICT (Idempotent)
        await saveManyLogs(rows, deviceSN);
        console.log(`📩 [${deviceSN}] Saved ${rows.length} logs from ${deviceIP}`);
        
        // 5. Invalidate feed attendance karena ada data baru dari push /iclock.
        // Report berat tidak dijatuhkan per event (refresh via TTL + precompute).
        const deleted = delCacheByPatterns(CACHE_PATTERNS.ATTENDANCE_EVENT)
        if (deleted > 0) {
          console.log(`🧹 Invalidated ${deleted} attendance cache keys after push from ${deviceSN}`)
        }

        // Broadcast realtime (SSE) agar dashboard feed segar setelah push device
        attendanceBus.emit('attendance:bulk', { count: rows.length, source: 'iclock' })
      }

      return res.status(200).send('OK');
    } catch (e) {
      console.error(`✗ [${deviceSN}] Push processing failed:`, e.message);
      // Selalu balas OK agar mesin tidak mengirim ulang data yang sama terus-menerus jika errornya di server
      return res.status(200).send('OK');
    }
  },


  async handleGetRequest(req, res) {
    try {
      const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'))
      const deviceSN = url.searchParams.get('SN') || null

      const cleanIp = req.ip.includes('::ffff:') ? req.ip.split('::ffff:')[1] : req.ip

      if (deviceSN) {
        // Hanya update DB jika IP baru atau belum pernah tercatat di sesi ini
        if (lastDeviceIPs.get(deviceSN) !== cleanIp) {
          await upsertDevice(deviceSN, cleanIp)
          lastDeviceIPs.set(deviceSN, cleanIp)
          // console.log(`🔄 Device Session Updated: SN=${deviceSN} IP=${cleanIp}`);
        }
      }

      // Menggunakan OK\n seringkali lebih stabil bagi beberapa firmware Solution/ZK
      return res.status(200).send('OK\n')
    } catch (e) {
      return res.status(200).send('OK\n')
    }
  }
}
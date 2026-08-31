import { mkdir, writeFile } from 'fs/promises'
import { config } from '../config/index.js'
import { smartParseMany, saveManyLogs, ensureRawDir, upsertDevice } from '../utils/index.js'
import { invalidateAttendanceFeed } from '../utils/cache.js'
import { attendanceBus } from '../utils/events.js'
import { pullDeviceLogs } from '../utils/zklib.js'

// Simple memory cache to reduce DB load
const lastDeviceIPs = new Map()

// ---------------------------------------------------------------------------
// Pull-on-contact
// Bukti lapangan: mesin fingerprint mode ADMS rajin poll GET /iclock/cdata
// (tiap ~2-3 detik) tetapi TIDAK mengirim upload absensi via HTTP POST.
// Solusi: setiap kali mesin menghubungi server, server langsung menjemput
// log-nya via PULL TCP (node-zklib) di background — data absensi muncul dalam
// hitungan detik ~30 detik tanpa bergantung pada setting upload di mesin.
// ---------------------------------------------------------------------------
const PULL_ON_CONTACT_INTERVAL_MS = Number(process.env.PULL_ON_CONTACT_INTERVAL_MS || 30000)
const lastPullBySN = new Map()
const inFlightPull = new Set()

async function pullOnContact(sn, ip, port = 4370) {
  if (!sn || sn === 'unknown') return
  const now = Date.now()
  if (inFlightPull.has(sn)) return
  if (now - (lastPullBySN.get(sn) || 0) < PULL_ON_CONTACT_INTERVAL_MS) return
  lastPullBySN.set(sn, now)
  inFlightPull.add(sn)
  try {
    const result = await pullDeviceLogs(ip, port, sn)
    if (result.count > 0) {
      console.log(`⚡ [pull-on-contact] ${sn} (${ip}): ${result.count} logs`)
      invalidateAttendanceFeed()
      attendanceBus.emit('attendance:bulk', { count: result.count, source: 'pull-on-contact' })
    }
  } catch (err) {
    // Handler /iclock tetap membalas OK; kegagalan PULL hanya dicatat.
    console.error(`❌ [pull-on-contact] ${sn} (${ip}):`, err.message)
  } finally {
    inFlightPull.delete(sn)
  }
}

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
        
        // 5. Invalidate feed attendance karena ada data baru dari push /iclock
        //    (coalesced — burst push tidak meng-invalidate per-event).
        invalidateAttendanceFeed()

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
        }
        // Fire-and-forget: jemput log mesin via TCP segera (di-throttle).
        pullOnContact(deviceSN, cleanIp).catch(() => {})
      }

      // Menggunakan OK\n seringkali lebih stabil bagi beberapa firmware Solution/ZK
      return res.status(200).send('OK\n')
    } catch (e) {
      return res.status(200).send('OK\n')
    }
  },

  /**
   * GET /iclock/cdata?SN=xxx — poll rutin perangkat ADMS untuk mengecek
   * perintah dari server. Sebelumnya rute ini TIDAK terdaftar sehingga
   * GET /iclock/cdata jatuh ke 404. Kini: (1) balasan ack protokol, dan
   * (2) memicu pull-on-contact agar log mesin langsung dijemput via TCP.
   */
  async handleCdataGet(req, res) {
    try {
      const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'))
      const deviceSN = url.searchParams.get('SN') || null
      const cleanIp = req.ip.includes('::ffff:') ? req.ip.split('::ffff:')[1] : req.ip

      if (deviceSN) {
        if (lastDeviceIPs.get(deviceSN) !== cleanIp) {
          await upsertDevice(deviceSN, cleanIp)
          lastDeviceIPs.set(deviceSN, cleanIp)
        }
        // Fire-and-forget: jemput log mesin via TCP segera (di-throttle).
        pullOnContact(deviceSN, cleanIp).catch(() => {})
      }

      // Balasan poll dikendalikan env ICLOCK_CDATA_RESPONSE agar bisa diuji:
      //   'C:0' (default) = idle / tidak ada perintah tertunda.
      //   'DATA START'    = minta mesin mengirim data (upload absensi).
      const body = (process.env.ICLOCK_CDATA_RESPONSE || 'C:0') + '\n'
      return res.status(200).send(body)
    } catch (e) {
      return res.status(200).send((process.env.ICLOCK_CDATA_RESPONSE || 'C:0') + '\n')
    }
  }
}

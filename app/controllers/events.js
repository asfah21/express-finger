import { attendanceBus } from '../utils/events.js'

// Heartbeat agar koneksi tetap hidup lewat proxy / load balancer
// (dan untuk deteksi dini koneksi mati oleh klien).
const HEARTBEAT_MS = 25000

function writeEvent(res, event, data) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export const eventsController = {
  /**
   * Server-Sent Events stream untuk feed absensi realtime.
   * Autentikasi via requireApiKey (JWT cookie) yang dipasang global di rute
   * /api — EventSource same-origin otomatis mengirim cookie.
   *
   * Client hanya menerima event minimal (attendance:new / attendance:bulk)
   * lalu melakukan refetch feed — bukan payload berat lewat SSE.
   */
  stream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nonaktifkan buffering nginx agar event langsung sampai ke klien
      'X-Accel-Buffering': 'no',
    })

    // Instruksi reconnect otomatis klien setelah 3 detik jika koneksi terputus
    res.write('retry: 3000\n\n')

    const onNew = (payload) => writeEvent(res, 'attendance:new', payload)
    const onBulk = (payload) => writeEvent(res, 'attendance:bulk', payload)

    attendanceBus.on('attendance:new', onNew)
    attendanceBus.on('attendance:bulk', onBulk)

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n')
    }, HEARTBEAT_MS)
    // Jangan halangi proses saat tidak ada klien (timer tidak menahan event loop)
    heartbeat.unref()

    res.on('close', () => {
      clearInterval(heartbeat)
      attendanceBus.off('attendance:new', onNew)
      attendanceBus.off('attendance:bulk', onBulk)
    })
  },
}

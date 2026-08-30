import { EventEmitter } from 'node:events'

/**
 * Event bus in-process untuk notifikasi realtime (SSE).
 *
 * Skala single-instance: EventEmitter Node sudah cukup — tanpa Redis.
 * Jika nanti aplikasi di-scale-out ke banyak instance, ganti mekanisme ini
 * dengan pub/sub (mis. Redis) agar event lintas-instance tersampaikan.
 *
 * Event yang dikirim:
 *   - 'attendance:new'  → satu absensi baru (kiosk kamera single)
 *   - 'attendance:bulk' → batch absensi (kiosk multi / push /iclock / auto-pull)
 *
 * Payload event sengaja minimal — klien cukup refetch feed, bukan menerima
 * seluruh data berat lewat SSE.
 */
export const attendanceBus = new EventEmitter()

// Banyak dashboard yang subscribe sekaligus; naikkan batas default (10) agar
// tidak memunculkan warning EventEmitter saat klien SSE lebih dari 10.
attendanceBus.setMaxListeners(200)

/**
 * Incremental session-state store untuk attendance engine.
 *
 * Menyimpan state sesi per user di memory sehingga anomaly detection bisa
 * "melanjutkan" dari state terakhir yang sudah diproses, alih-alih menscan
 * ulang seluruh history setiap kali (Tahap 3 — incremental state machine).
 *
 * Alur:
 *   - processAttendance() men-seed state machine dari store ini (bila valid),
 *   - lalu menulis-balik state final untuk feed yang tidak terfilter
 *     (updateStore=true), sehingga store selalu mencerminkan state "terbaru".
 *
 * Entri kadaluarsa otomatis mengikuti session window (15 jam) — sejalan dengan
 * SESSION_TIMEOUT_HOURS di attendance-engine — dan dibatasi jumlah entrinya.
 * Skala single-instance: store in-memory cukup (tanpa Redis).
 */

const SESSION_TIMEOUT_HOURS = 15
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 5000

export class SessionStateStore {
  constructor() {
    this.map = new Map()
    this.sweepTimer = setInterval(() => this.sweepExpired(), SWEEP_INTERVAL_MS)
    if (this.sweepTimer.unref) this.sweepTimer.unref()
  }

  /**
   * Ambil state sesi tersimpan untuk user (null jika tidak ada / kadaluarsa).
   * @param {number|string} userId
   * @returns {object|null}
   */
  get(userId) {
    const key = String(userId)
    const entry = this.map.get(key)
    if (!entry) return null
    // Lazy expiry
    if (Date.now() - entry.updatedAt > SESSION_TIMEOUT_HOURS * 3600_000) {
      this.map.delete(key)
      return null
    }
    return entry.state
  }

  /**
   * Simpan state sesi untuk user.
   * @param {number|string} userId
   * @param {object|null} state
   */
  set(userId, state) {
    if (!state) return
    const key = String(userId)
    if (!this.map.has(key) && this.map.size >= MAX_ENTRIES) {
      // Evict entri tertua (FIFO) bila kapasitas penuh
      const oldestKey = this.map.keys().next().value
      this.map.delete(oldestKey)
    }
    this.map.set(key, { state, updatedAt: Date.now() })
  }

  /** Hapus entri yang sudah melewati session window (15 jam). */
  sweepExpired() {
    const now = Date.now()
    const timeoutMs = SESSION_TIMEOUT_HOURS * 3600_000
    for (const [key, entry] of this.map) {
      if (now - entry.updatedAt > timeoutMs) this.map.delete(key)
    }
  }

  get size() {
    return this.map.size
  }

  /** Hentikan timer sweep (dipakai saat shutdown / di test). */
  stop() {
    clearInterval(this.sweepTimer)
  }
}

// Singleton yang dipakai aplikasi (di-import oleh controllers).
export const sessionState = new SessionStateStore()

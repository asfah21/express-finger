import { mkdir, readdir, stat, unlink } from 'fs/promises'
import path from 'path'
import { config } from '../config/index.js'

import { SYNC_CONFIG } from '../config/sync.js'

// Cleanup raw files
export async function cleanupOldRawFiles() {
  try {
    const files = await readdir(config.RAW_DIR)
    const now = Date.now()
    const maxAge = SYNC_CONFIG.KEEP_RAW_FILES_DAYS * 24 * 60 * 60 * 1000

    let deletedCount = 0
    for (const f of files) {
      const fpath = path.join(config.RAW_DIR, f)
      const st = await stat(fpath)
      if (!st.isFile()) continue

      if (now - st.mtimeMs > maxAge) {
        await unlink(fpath)
        deletedCount++
      }
    }
    if (deletedCount > 0) {
      console.log(`🧹 Cleanup: Deleted ${deletedCount} old raw push files from ${config.RAW_DIR}`)
    }
  } catch (e) {
    console.warn('⚠️ Cleanup error:', e.message)
  }
}

// Ensure raw directory exists
export async function ensureRawDir() {
  await mkdir(config.RAW_DIR, { recursive: true })
}
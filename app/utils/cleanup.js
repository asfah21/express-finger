import { mkdir, readdir, stat, unlink } from 'fs/promises'
import path from 'path'
import { config } from '../config/index.js'

// Cleanup raw files
export async function cleanupOldRawFiles() {
  try {
    const files = await readdir(config.RAW_DIR)
    const now = Date.now()
    for (const f of files) {
      const fpath = path.join(config.RAW_DIR, f)
      const st = await stat(fpath)
      if (now - st.mtimeMs > config.CLEANUP_AGE_DAYS * 24 * 60 * 60 * 1000) {
        await unlink(fpath)
        console.log(`🧹 deleted old raw file: ${f}`)
      }
    }
  } catch (e) {
    console.warn('⚠️ cleanup error:', e.message)
  }
}

// Ensure raw directory exists
export async function ensureRawDir() {
  await mkdir(config.RAW_DIR, { recursive: true })
}
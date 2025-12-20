import { mkdir, writeFile } from 'fs/promises'
import { config } from '../config/index.js'
import { smartParseMany, saveManyLogs, ensureRawDir } from '../utils/index.js'

// Device controller
export const deviceController = {
  async handleCdata(req, res) {
    try {
      const url = new URL(req.url, 'http://x')
      const deviceSN = url.searchParams.get('SN') || null
      await ensureRawDir()

      const raw = typeof req.body === 'string'
        ? req.body
        : (typeof req.body === 'object' && req.body ? new URLSearchParams(req.body).toString() : '')
      const pathFile = `${config.RAW_DIR}/last_push-${Date.now()}.txt`
      await writeFile(pathFile, raw)
      console.log(`📝 raw saved: ${pathFile} | bytes: ${raw.length} | SN: ${deviceSN}`)

      const rows = smartParseMany(req)
      if (!rows.length) {
        console.warn('⚠️ parsed 0 row(s). SN=', deviceSN)
      } else {
        await saveManyLogs(rows, deviceSN)
        console.log(`📩 PUSH saved ${rows.length} logs from SN ${deviceSN}`)
      }
      return res.status(200).send('OK')
    } catch (e) {
      console.error('✗ push error:', e.message)
      return res.status(200).send('OK')
    }
  },

  handleGetRequest(_req, res) {
    res.status(200).send('OK')
  }
}
import ZKLib from 'zklib'
import { saveManyLogs } from './database.js'

/**
 * Pull logs from a device using TCP protocol (Port 4370)
 * @param {string} ip - Device IP address
 * @param {number} port - Device port (default 4370)
 */
export async function pullDeviceLogs(ip, port = 4370) {
  const zk = new ZKLib(ip, port, 10000, 4000)
  try {
    // Connect to device
    console.log(`🔌 Connecting to device ${ip}:${port}...`)
    await zk.createSocket()

    // Get basic info
    const sn = await zk.getSerialNumber()
    console.log(`🆔 Device Serial Number: ${sn}`)

    // Get attendance logs
    console.log(`📥 Fetching logs from ${ip}...`)
    const logs = await zk.getAttendance()
    console.log(`📦 Received ${logs.data.length} logs from device ${sn}`)

    if (logs.data.length > 0) {
      // Format logs to match our schema
      // zklib returns: { uid, id, state, verification, deviceDot, timestamp }
      // id is usually the userId
      const formattedLogs = logs.data.map(log => ({
        uid: log.uid,
        userId: log.id,
        timestamp: log.timestamp,
        type: log.state // state in zklib usually corresponds to check type
      }))

      await saveManyLogs(formattedLogs, sn)
      console.log(`✅ Successfully synced ${formattedLogs.length} logs from ${sn}`)
      
      // We don't clear logs from device automatically to stay safe
      // but ADMS usually handles that if configured.
    }

    await zk.disconnect()
    return {
      success: true,
      sn,
      count: logs.data.length
    }
  } catch (error) {
    console.error(`❌ Error pulling logs from ${ip}:`, error.message)
    try {
      await zk.disconnect()
    } catch (e) {
      // ignore
    }
    throw error
  }
}

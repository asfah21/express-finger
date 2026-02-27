import ZKLib from 'zklib'
import { promisify } from 'util'
import { saveManyLogs } from './database.js'

/**
 * Pull logs from a device using TCP protocol (Port 4370)
 * @param {string} ip - Device IP address
 * @param {number} port - Device port (default 4370)
 */
export async function pullDeviceLogs(ip, port = 4370) {
    // Fix: ZKLib 0.2.11 expects an options object
    const zk = new ZKLib({
        ip,
        port: parseInt(port),
        timeout: 10000,
        inport: 5200 + Math.floor(Math.random() * 1000), // Random port to avoid conflicts
        connectionType: 'tcp'
    })

    // Promisify the methods needed
    const connect = promisify(zk.connect).bind(zk)
    const getAttendance = promisify(zk.getAttendance).bind(zk)
    const getSerialNumber = promisify(zk.serialNumber).bind(zk)
    const disconnect = promisify(zk.disconnect).bind(zk)

    try {
        console.log(`🔌 Connecting to device ${ip}:${port}...`)
        await connect()

        // Get basic info
        const sn = await getSerialNumber()
        console.log(`🆔 Device Serial Number: ${sn}`)

        // Get attendance logs
        console.log(`📥 Fetching logs from ${ip}...`)
        const logs = await getAttendance()

        // Some versions of zklib return an array directly, some return { data: [] }
        const attendanceData = Array.isArray(logs) ? logs : (logs?.data || [])
        console.log(`📦 Received ${attendanceData.length} logs from device ${sn}`)

        if (attendanceData.length > 0) {
            // Format logs to match our schema
            const formattedLogs = attendanceData.map(log => ({
                uid: log.uid,
                userId: log.id || log.userId,
                timestamp: log.timestamp,
                type: log.state || log.status // state/status usually corresponds to check type
            }))

            await saveManyLogs(formattedLogs, sn)
            console.log(`✅ Successfully synced ${formattedLogs.length} logs from ${sn}`)
        }

        await disconnect()
        return {
            success: true,
            sn,
            count: attendanceData.length
        }
    } catch (error) {
        console.error(`❌ Error pulling logs from ${ip}:`, error.message)
        try {
            // In case of error, try to close the socket
            if (zk.socket) {
                zk.closeSocket()
            }
        } catch (e) {
            // ignore
        }
        throw error
    }
}

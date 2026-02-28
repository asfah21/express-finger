import { pool } from './utils/database.js'

async function debugLogs() {
    try {
        const userId = '16'
        const res = await pool.query({
            text: `
                SELECT id, user_id, timestamp, type, device_sn, created_at 
                FROM attendance_logs 
                WHERE user_id = $1 
                ORDER BY timestamp DESC
            `,
            values: [userId]
        })

        const threeDaysAgo = new Date()
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

        console.log("LOGS_START")
        console.log(JSON.stringify({
            userId,
            totalFound: res.rows.length,
            sample: res.rows.slice(0, 50),
            threeDaysAgoMs: threeDaysAgo.getTime()
        }))
        console.log("LOGS_END")

        const allLogs = await pool.query("SELECT user_id, COUNT(*) FROM attendance_logs GROUP BY user_id")
        const allDevices = await pool.query("SELECT sn, ip, last_sync FROM devices")
        const lastLogs = await pool.query("SELECT * FROM attendance_logs ORDER BY timestamp DESC LIMIT 10")

        const countRes = await pool.query("SELECT COUNT(*) FROM attendance_logs")
        const totalLogs = countRes.rows[0].count

        console.log("DEBUG_DATA_START")
        console.log(JSON.stringify({
            userCounts: allLogs.rows,
            devices: allDevices.rows,
            last10Logs: lastLogs.rows,
            totalLogs: totalLogs
        }))
        console.log("DEBUG_DATA_END")

        const allData = await pool.query("SELECT * FROM attendance_logs ORDER BY timestamp DESC")
        console.log("FULL_DATA_JSON_START")
        console.log(JSON.stringify(allData.rows, null, 2))
        console.log("FULL_DATA_JSON_END")

    } catch (e) {
        console.error(e.message)
    } finally {
        process.exit()
    }
}
debugLogs()

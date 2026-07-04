import { pool } from '../../app/utils/database.js'

async function testInsert() {
    try {
        console.log("Inserting test log...")
        const ts = new Date()
        const res = await pool.query(`
            INSERT INTO attendance_logs (user_id, timestamp, type, device_sn)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, ['TEST_USER', ts, 0, 'TEST_SN'])

        console.log("Insert result:", res.rows[0])

        const count = await pool.query("SELECT COUNT(*) FROM attendance_logs")
        console.log("Total logs now:", count.rows[0].count)
    } catch (e) {
        console.error("Insert failed:", e.message)
    } finally {
        process.exit()
    }
}
testInsert()

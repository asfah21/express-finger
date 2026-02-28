import { pool } from './utils/database.js'

async function check() {
    try {
        const res = await pool.query("SELECT * FROM devices")
        console.log(JSON.stringify(res.rows, null, 2))
    } catch (e) {
        console.log(e.message)
    } finally {
        process.exit()
    }
}
check()

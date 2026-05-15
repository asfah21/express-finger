import { pool } from './utils/database.js';
async function test() {
    try {
        const { rows } = await pool.query(`
          SELECT 
            TO_CHAR("timestamp", 'YYYY-MM-DD HH24:MI:SS') as raw_str,
            TO_CHAR("timestamp" AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD HH24:MI:SS') as wita_str,
            TO_CHAR("timestamp" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') as utc_str,
            "timestamp" as raw_ts, type 
          FROM attendance_logs 
          WHERE user_id='16' 
          ORDER BY timestamp DESC LIMIT 5
        `);
        console.table(rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
test();

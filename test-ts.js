import { pool } from './app/utils/database.js';

async function test() {
    try {
        const query = `
          SELECT 
            id, user_id, type,
            "timestamp" as raw_ts,
            "timestamp" AT TIME ZONE 'Asia/Makassar' as wita_ts,
            TO_CHAR("timestamp" AT TIME ZONE 'Asia/Makassar', 'HH24:MI:SS') as wita_time,
            "timestamp" AT TIME ZONE 'UTC' as utc_ts
          FROM attendance_logs
          WHERE user_id = '16'
          ORDER BY "timestamp" DESC
          LIMIT 10;
        `;
        const { rows } = await pool.query(query);
        console.table(rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
test();

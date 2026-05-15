import { pool } from './app/utils/database.js';

async function check() {
    try {
        const res = await pool.query(`
            SELECT id, user_id, type, "timestamp" AT TIME ZONE 'Asia/Makassar' as local_time, "timestamp"
            FROM attendance_logs
            WHERE user_id = '16'
            ORDER BY "timestamp" DESC
            LIMIT 10;
        `);
        console.table(res.rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
check();

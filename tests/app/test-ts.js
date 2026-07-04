import { pool } from '../../app/utils/database.js';
async function test() {
    try {
        const { rows } = await pool.query(`SELECT MAX("timestamp") as mx FROM attendance_logs`);
        console.table(rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
test();

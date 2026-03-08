import { pool } from './app/utils/database.js';

async function testQuery() {
    try {
        const { rows } = await pool.query(`
      SELECT 
        al.id,
        al.user_id,
        al.type,
        al."timestamp",
        EXISTS (
          SELECT 1 FROM attendance_logs a2
          WHERE a2.user_id = al.user_id AND a2.type = al.type
          AND DATE(a2."timestamp" AT TIME ZONE 'Asia/Makassar') = DATE(al."timestamp" AT TIME ZONE 'Asia/Makassar')
          AND a2."timestamp" < al."timestamp"
        ) as is_duplicate
      FROM attendance_logs al
      ORDER BY al."timestamp" DESC
      LIMIT 5
    `);
        console.log(rows);
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

testQuery();

import { pool } from './utils/database.js'

async function diagnose() {
    try {
        // 1. Cek data user 16 - semua yang ada
        const user16 = await pool.query(`
            SELECT user_id, timestamp, type, device_sn 
            FROM attendance_logs 
            WHERE user_id = '16' 
            ORDER BY timestamp DESC 
            LIMIT 20
        `)
        console.log('\n=== DATA USER 16 (20 terbaru) ===')
        console.log(JSON.stringify(user16.rows, null, 2))

        // 2. Cek range tanggal data yang ada untuk user 16
        const range16 = await pool.query(`
            SELECT 
                MIN(timestamp) as paling_lama,
                MAX(timestamp) as paling_baru,
                COUNT(*) as total
            FROM attendance_logs WHERE user_id = '16'
        `)
        console.log('\n=== RANGE DATA USER 16 ===')
        console.log(JSON.stringify(range16.rows[0], null, 2))

        // 3. Cek tanggal 2-3 hari lalu, semua user, untuk tau mesin mana yang aktif
        const twoDaysAgo = new Date()
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 3)
        const recent = await pool.query(`
            SELECT user_id, timestamp, type, device_sn 
            FROM attendance_logs 
            WHERE timestamp >= $1
            ORDER BY timestamp DESC
            LIMIT 30
        `, [twoDaysAgo])
        console.log(`\n=== DATA 3 HARI TERAKHIR (semua user) ===`)
        console.log(JSON.stringify(recent.rows, null, 2))

        // 4. Cek jumlah data per device_sn setelah sync terakhir
        const perDevice = await pool.query(`
            SELECT device_sn, COUNT(*) as total, MAX(timestamp) as terakhir
            FROM attendance_logs
            GROUP BY device_sn
            ORDER BY terakhir DESC
        `)
        console.log('\n=== DATA PER MESIN ===')
        console.log(JSON.stringify(perDevice.rows, null, 2))

    } catch (e) {
        console.error('Error:', e.message)
    } finally {
        process.exit()
    }
}
diagnose()

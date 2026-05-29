/**
 * Script untuk membersihkan device "hantu" dengan SN palsu (PULL-{IP})
 * yang tersimpan di database akibat bug sebelumnya.
 * 
 * Cara pakai: node clean-ghost-devices.js
 */
import { pool } from './utils/database.js'

async function cleanGhostDevices() {
    console.log('🔍 Mencari device dengan SN palsu (PULL-*)...')
    
    const { rows } = await pool.query(
        "SELECT id, sn, ip, name FROM devices WHERE sn LIKE 'PULL-%'"
    )
    
    if (rows.length === 0) {
        console.log('✅ Tidak ada device palsu ditemukan. Database sudah bersih.')
        await pool.end()
        return
    }
    
    console.log(`\n⚠️ Ditemukan ${rows.length} device palsu:`)
    rows.forEach(r => {
        console.log(`   - ID: ${r.id} | SN: ${r.sn} | IP: ${r.ip} | Name: ${r.name || '-'}`)
    })
    
    // Hapus semua device palsu
    const { rowCount } = await pool.query(
        "DELETE FROM devices WHERE sn LIKE 'PULL-%'"
    )
    
    console.log(`\n✅ Berhasil menghapus ${rowCount} device palsu dari database.`)
    
    await pool.end()
}

cleanGhostDevices().catch(err => {
    console.error('❌ Error:', err.message)
    process.exit(1)
})

/**
 * Utility untuk reset password user
 * 
 * Cara pakai:
 * node reset-password.js <username> <new-password>
 * 
 * Contoh:
 * node reset-password.js superadmin admin123
 * 
 * Catatan: Password akan di-hash otomatis saat login pertama
 * (lihat auto-upgrade di controllers/auth.js)
 */

const { Pool } = require('pg')
const crypto = require('crypto')

const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'express_finger',
  password: process.env.PGPASSWORD || 'postgres',
  port: parseInt(process.env.PGPORT || '5432'),
})

async function resetPassword() {
    const args = process.argv.slice(2)
    
    if (args.length < 2) {
        console.log('Usage: node reset-password.js <username> <new-password>')
        console.log('Example: node reset-password.js superadmin admin123')
        console.log('')
        console.log('Environment variables (or edit this file):')
        console.log('  PGUSER, PGHOST, PGDATABASE, PGPASSWORD, PGPORT')
        process.exit(1)
    }

    const [username, newPassword] = args

    if (newPassword.length < 6) {
        console.error('❌ Password must be at least 6 characters')
        process.exit(1)
    }

    try {
        // Check if user exists
        const { rows } = await pool.query('SELECT id, username FROM users WHERE username = $1', [username])
        
        if (rows.length === 0) {
            console.error(`❌ User "${username}" not found`)
            console.log('')
            console.log('Available users:')
            const { rows: allUsers } = await pool.query('SELECT username, role FROM users ORDER BY id')
            if (allUsers.length === 0) {
                console.log('  (no users found)')
            } else {
                allUsers.forEach(u => console.log(`  - ${u.username}`))
            }
            process.exit(1)
        }

        // Store as SHA256 hash (will be auto-upgraded to bcrypt on next login)
        // This avoids needing bcryptjs dependency
        const shaHash = crypto.createHash('sha256').update(newPassword).digest('hex')
        await pool.query('UPDATE users SET password = $1 WHERE username = $2', [shaHash, username])
        
        console.log(`✅ Password for "${username}" has been reset successfully!`)
        console.log(`   New password: ${newPassword}`)
        console.log('')
        console.log('⚠️  Note: Password will be auto-upgraded to bcrypt on next login.')
        
        await pool.end()
    } catch (err) {
        console.error('❌ Error:', err.message)
        process.exit(1)
    }
}

resetPassword()

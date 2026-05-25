/**
 * Utility untuk reset password user
 * 
 * Cara pakai:
 * node reset-password.js <username> <new-password>
 * 
 * Contoh:
 * node reset-password.js superadmin admin123
 */

import { pool } from './utils/database.js'
import bcrypt from 'bcryptjs'

async function resetPassword() {
    const args = process.argv.slice(2)
    
    if (args.length < 2) {
        console.log('Usage: node reset-password.js <username> <new-password>')
        console.log('Example: node reset-password.js superadmin admin123')
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
            console.log('Available users:')
            const { rows: allUsers } = await pool.query('SELECT username, role FROM users ORDER BY id')
            allUsers.forEach(u => console.log(`  - ${u.username} (${u.role})`))
            process.exit(1)
        }

        const hashed = await bcrypt.hash(newPassword, 10)
        await pool.query('UPDATE users SET password = $1 WHERE username = $2', [hashed, username])
        
        console.log(`✅ Password for "${username}" has been reset successfully!`)
        console.log(`   New password: ${newPassword}`)
        
        await pool.end()
    } catch (err) {
        console.error('❌ Error:', err.message)
        process.exit(1)
    }
}

resetPassword()

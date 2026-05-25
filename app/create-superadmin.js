/**
 * Utility untuk membuat user superadmin baru
 * 
 * Cara pakai:
 *   node create-superadmin.js <username> <password>
 * 
 * Contoh:
 *   node create-superadmin.js superadmin 9510Asfah210
 */

import pkg from 'pg'
import crypto from 'crypto'
const { Pool } = pkg

const pool = new Pool({
  user: process.env.PGUSER || 'admin',
  host: process.env.PGHOST || 'db',
  database: process.env.PGDATABASE || 'gsi-finger',
  password: process.env.PGPASSWORD || 'Gsi651admin',
  port: parseInt(process.env.PGPORT || '5432'),
})

async function createSuperadmin() {
    const args = process.argv.slice(2)
    
    if (args.length < 2) {
        console.log('Usage: node create-superadmin.js <username> <password>')
        console.log('Example: node create-superadmin.js superadmin 9510Asfah210')
        console.log('')
        console.log('Environment variables:')
        console.log('  PGUSER, PGHOST, PGDATABASE, PGPASSWORD, PGPORT')
        process.exit(1)
    }

    const [username, password] = args

    if (password.length < 6) {
        console.error('Password must be at least 6 characters')
        process.exit(1)
    }

    try {
        // Check if username already exists
        const { rows } = await pool.query('SELECT id, username FROM users WHERE username = $1', [username])
        
        if (rows.length > 0) {
            console.log(`User "${username}" already exists with role: checking...`)
            const { rows: userRows } = await pool.query('SELECT role FROM users WHERE username = $1', [username])
            
            if (userRows[0].role === 'superadmin') {
                console.log(`User "${username}" is already a superadmin.`)
                console.log('Use reset-password.js to change password.')
            } else {
                // Upgrade to superadmin
                const shaHash = crypto.createHash('sha256').update(password).digest('hex')
                await pool.query('UPDATE users SET password = $1, role = $2 WHERE username = $3', [shaHash, 'superadmin', username])
                console.log(`User "${username}" has been upgraded to superadmin!`)
                console.log(`New password: ${password}`)
                console.log('Note: Password will be auto-upgraded to bcrypt on next login.')
            }
        } else {
            // Create new superadmin user
            const shaHash = crypto.createHash('sha256').update(password).digest('hex')
            await pool.query(
                'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
                [username, shaHash, 'superadmin']
            )
            console.log(`Superadmin user "${username}" created successfully!`)
            console.log(`Password: ${password}`)
            console.log('Note: Password will be auto-upgraded to bcrypt on next login.')
        }
        
        await pool.end()
    } catch (err) {
        console.error('Error:', err.message)
        process.exit(1)
    }
}

createSuperadmin()

import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { pool } from '../utils/database.js'
import { recordActivity } from './activity-log.js'

const SECRET = process.env.JWT_SECRET || 'express-finger-secret-key-123'

function getClientIp(req) {
    return (
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        ''
    )
}

export const login = async (req, res) => {
    const { username, password } = req.body
    const ip = getClientIp(req)

    if (!username || !password) {
        return res.status(400).json({ status: 'error', message: 'Username and password are required' })
    }

    try {
        const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username])
        const user = rows[0]

        if (!user) {
            await recordActivity({ username, action: 'login', category: 'auth', detail: 'Login failed: user not found', ip, status: 'failed' })
            return res.status(401).json({ status: 'error', message: 'Invalid username or password' })
        }

        // Support both bcrypt hashed passwords and plain text (migration compatibility)
        let passwordMatch = false
        if (user.password.startsWith('$2')) {
            // bcrypt hash
            passwordMatch = await bcrypt.compare(password, user.password)
        } else {
            // Plain text (legacy) - auto-upgrade to bcrypt
            passwordMatch = user.password === password
            if (passwordMatch) {
                const hashed = await bcrypt.hash(password, 10)
                await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, user.id])
                console.log(`✅ Password for user "${username}" auto-upgraded to bcrypt hash`)
            }
        }

        if (!passwordMatch) {
            await recordActivity({ username, action: 'login', category: 'auth', detail: 'Login failed: wrong password', ip, status: 'failed' })
            return res.status(401).json({ status: 'error', message: 'Invalid username or password' })
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            SECRET,
            { expiresIn: '3d' }
        )

        // Set cookie - sameSite 'lax' agar cookie tetap ada saat refresh
        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'

        res.cookie('token', token, {
            httpOnly: true,
            secure: isSecure, // true jika HTTPS
            sameSite: isSecure ? 'none' : 'lax', // none jika HTTPS/cross, lax jika HTTP
            path: '/',
            maxAge: 3 * 24 * 60 * 60 * 1000 // 3 hari
        })

        await recordActivity({ username: user.username, action: 'login', category: 'auth', detail: `Login successful (role: ${user.role})`, ip, status: 'success' })

        res.json({
            status: 'success',
            data: {
                token,
                user: {
                    username: user.username,
                    role: user.role
                }
            }
        })
    } catch (err) {
        console.error('Login error:', err)
        res.status(500).json({ status: 'error', message: 'Internal server error' })
    }
}

export const logout = async (req, res) => {
    // Try to get username from token for logging
    const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1]
    let username = 'unknown'
    try {
        if (token) {
            const decoded = jwt.verify(token, SECRET)
            username = decoded.username
        }
    } catch (_) { }

    const ip = getClientIp(req)
    await recordActivity({ username, action: 'logout', category: 'auth', detail: 'User logged out', ip })

    res.clearCookie('token', { path: '/' })
    res.json({ status: 'success', message: 'Logged out' })
}

export const me = (req, res) => {
    res.json({
        status: 'success',
        data: {
            user: req.user
        }
    })
}

export const verify = async (req, res) => {
    const { password } = req.body
    const userId = req.user.id
    const ip = getClientIp(req)

    if (!password) {
        return res.status(400).json({ status: 'error', message: 'Password is required' })
    }

    try {
        const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [userId])
        const user = rows[0]

        if (!user) return res.status(404).json({ status: 'error', message: 'User not found' })

        const match = await bcrypt.compare(password, user.password)
        if (match) {
            await recordActivity({
                username: req.user.username,
                action: 'verify_settings_access',
                category: 'auth',
                detail: 'Secondary authentication successful for settings access',
                ip
            })
            return res.json({ status: 'success', message: 'Verified' })
        } else {
            await recordActivity({
                username: req.user.username,
                action: 'verify_settings_access',
                category: 'auth',
                detail: 'Secondary authentication failed: wrong password',
                ip,
                status: 'failed'
            })
            return res.status(401).json({ status: 'error', message: 'Invalid password' })
        }
    } catch (err) {
        console.error('Verify error:', err)
        res.status(500).json({ status: 'error', message: 'Verification failed' })
    }
}

export const updateAccount = async (req, res) => {
    const { username, password } = req.body
    const userId = req.user.id
    const ip = getClientIp(req)

    try {
        if (!username && !password) {
            return res.status(400).json({ status: 'error', message: 'Nothing to update' })
        }

        let query = 'UPDATE users SET '
        const params = []
        const sets = []

        if (username) {
            sets.push(`username = $${params.length + 1}`)
            params.push(username)
        }
        if (password) {
            const hashed = await bcrypt.hash(password, 10)
            sets.push(`password = $${params.length + 1}`)
            params.push(hashed)
        }

        query += sets.join(', ') + ` WHERE id = $${params.length + 1} RETURNING username, role`
        params.push(userId)

        const { rows } = await pool.query(query, params)

        // Re-generate token with new username if changed
        const user = rows[0]
        const token = jwt.sign(
            { id: userId, username: user.username, role: user.role },
            SECRET,
            { expiresIn: '3d' }
        )

        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'
        res.cookie('token', token, {
            httpOnly: true,
            secure: isSecure,
            sameSite: isSecure ? 'none' : 'lax',
            path: '/',
            maxAge: 3 * 24 * 60 * 60 * 1000
        })

        const changes = []
        if (username) changes.push(`username changed to "${username}"`)
        if (password) changes.push('password changed')
        await recordActivity({
            username: req.user.username,
            action: 'update_account',
            category: 'auth',
            detail: `Account updated: ${changes.join(', ')}`,
            ip
        })

        res.json({ status: 'success', message: 'Profile updated', data: { user } })
    } catch (err) {
        console.error('Update account error:', err)
        res.status(500).json({ status: 'error', message: 'Failed to update account' })
    }
}

// ============================================================
// User Management (Admin only)
// ============================================================

export const listUsers = async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, username, role, created_at FROM users ORDER BY id ASC'
        )
        res.json({ status: 'success', data: rows })
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message })
    }
}

export const addUser = async (req, res) => {
    const { username, password, role = 'admin' } = req.body
    const ip = getClientIp(req)

    if (!username || !password) {
        return res.status(400).json({ status: 'error', message: 'Username and password are required' })
    }
    if (password.length < 6) {
        return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' })
    }

    try {
        const hashed = await bcrypt.hash(password, 10)
        const { rows } = await pool.query(
            'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
            [username, hashed, role]
        )

        await recordActivity({
            username: req.user.username,
            action: 'add_user',
            category: 'auth',
            detail: `Created new user: "${username}" (role: ${role})`,
            ip
        })

        res.status(201).json({ status: 'success', data: rows[0] })
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ status: 'error', message: 'Username already exists' })
        }
        res.status(500).json({ status: 'error', message: err.message })
    }
}

export const deleteUser = async (req, res) => {
    const { id } = req.params
    const ip = getClientIp(req)

    // Prevent self-deletion
    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ status: 'error', message: 'Cannot delete your own account' })
    }

    try {
        const { rows: userRows } = await pool.query('SELECT username FROM users WHERE id = $1', [id])
        const targetUser = userRows[0]
        if (!targetUser) return res.status(404).json({ status: 'error', message: 'User not found' })

        // Prevent deleting the last user
        const { rows: countRows } = await pool.query('SELECT COUNT(*)::int as total FROM users')
        if (countRows[0].total <= 1) {
            return res.status(400).json({ status: 'error', message: 'Cannot delete the last remaining user' })
        }

        await pool.query('DELETE FROM users WHERE id = $1', [id])

        await recordActivity({
            username: req.user.username,
            action: 'delete_user',
            category: 'auth',
            detail: `Deleted user: "${targetUser.username}"`,
            ip
        })

        res.json({ status: 'success', message: `User "${targetUser.username}" deleted` })
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message })
    }
}

export const resetUserPassword = async (req, res) => {
    const { id } = req.params
    const { password } = req.body
    const ip = getClientIp(req)

    if (!password || password.length < 6) {
        return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' })
    }

    try {
        const { rows: userRows } = await pool.query('SELECT username FROM users WHERE id = $1', [id])
        const targetUser = userRows[0]
        if (!targetUser) return res.status(404).json({ status: 'error', message: 'User not found' })

        const hashed = await bcrypt.hash(password, 10)
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, id])

        await recordActivity({
            username: req.user.username,
            action: 'reset_password',
            category: 'auth',
            detail: `Reset password for user: "${targetUser.username}"`,
            ip
        })

        res.json({ status: 'success', message: `Password for "${targetUser.username}" has been reset` })
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message })
    }
}

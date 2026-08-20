import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { pool } from '../utils/database.js'
import { recordActivity } from './activity-log.js'
import { sendSuccess, sendError } from '../utils/response.js'
import { createSession, revokeSession, revokeAllUserSessions, revokeDuplicateDeviceSessions } from '../utils/sessions.js'

const SECRET = process.env.JWT_SECRET
if (!SECRET) {
    console.error('❌ JWT_SECRET is not set in environment variables!')
    console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
    process.exit(1)
}

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
        return sendError(res, 'Username and password are required', 400)
    }

    try {
        const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username])
        const user = rows[0]

        if (!user) {
            await recordActivity({ username, action: 'login', category: 'auth', detail: 'Login failed: user not found', ip, status: 'failed' })
            return sendError(res, 'Invalid username or password', 401)
        }

        // Support bcrypt hashed passwords, plain text, and SHA256 (migration compatibility)
        let passwordMatch = false
        if (user.password.startsWith('$2')) {
            // bcrypt hash
            passwordMatch = await bcrypt.compare(password, user.password)
        } else if (user.password.length === 64 && /^[a-f0-9]+$/.test(user.password)) {
            // SHA256 hash (from reset-password.js utility)
            const crypto = await import('crypto')
            const shaHash = crypto.createHash('sha256').update(password).digest('hex')
            passwordMatch = shaHash === user.password
            if (passwordMatch) {
                const hashed = await bcrypt.hash(password, 10)
                await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, user.id])
                console.log(`✅ Password for user "${username}" auto-upgraded from SHA256 to bcrypt hash`)
            }
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
            return sendError(res, 'Invalid username or password', 401)
        }

        const jti = randomUUID()
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, jti },
            SECRET,
            { expiresIn: '3d' }
        )

        // Track this login as an active session so Super Admin can see it
        // and force-logout it later. Non-fatal: if it fails we still allow
        // the login (the session simply won't appear on the Active Sessions page).
        try {
            await createSession({
                jti,
                userId: user.id,
                username: user.username,
                role: user.role,
                ip,
                userAgent: req.get('user-agent') || '',
                expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
            })

            // Dedupe per device: revoke older active sessions of the same user
            // from the SAME device (same IP + user agent) so re-login does not
            // leave a stale "double" session. Different devices stay logged in.
            await revokeDuplicateDeviceSessions({
                userId: user.id,
                ip,
                userAgent: req.get('user-agent') || '',
                exceptJti: jti,
                revokedBy: user.username,
            })
        } catch (err) {
            console.error('❌ Failed to create session for login:', err.message)
        }

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

        sendSuccess(res, {
            token,
            user: {
                username: user.username,
                role: user.role
            }
        })
    } catch (err) {
        console.error('Login error:', err)
        sendError(res, 'Internal server error', 500)
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
    sendSuccess(res, null, 'Logged out')
}

export const me = (req, res) => {
    sendSuccess(res, { user: req.user })
}

export const verify = async (req, res) => {
    const { password } = req.body
    const userId = req.user.id
    const ip = getClientIp(req)

    if (!password) {
        return sendError(res, 'Password is required', 400)
    }

    try {
        const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [userId])
        const user = rows[0]

        if (!user) return sendError(res, 'User not found', 404)

        const match = await bcrypt.compare(password, user.password)
        if (match) {
            await recordActivity({
                username: req.user.username,
                action: 'verify_settings_access',
                category: 'auth',
                detail: 'Secondary authentication successful for settings access',
                ip
            })
            return sendSuccess(res, null, 'Verified')
        } else {
            await recordActivity({
                username: req.user.username,
                action: 'verify_settings_access',
                category: 'auth',
                detail: 'Secondary authentication failed: wrong password',
                ip,
                status: 'failed'
            })
            return sendError(res, 'Invalid password', 401)
        }
    } catch (err) {
        console.error('Verify error:', err)
        sendError(res, 'Verification failed')
    }
}

export const updateAccount = async (req, res) => {
    const { username, password } = req.body
    const userId = req.user.id
    const ip = getClientIp(req)

    try {
        if (!username && !password) {
            return sendError(res, 'Nothing to update', 400)
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
        const newJti = randomUUID()
        const token = jwt.sign(
            { id: userId, username: user.username, role: user.role, jti: newJti },
            SECRET,
            { expiresIn: '3d' }
        )

        // Issue a new tracked session for the fresh token. Only end the old
        // session when the password changed — a mere username change should
        // not force other tabs of the same user to log out.
        const oldJti = req.user?.jti
        try {
            if (oldJti && password) await revokeSession(oldJti, req.user.username)
            await createSession({
                jti: newJti,
                userId,
                username: user.username,
                role: user.role,
                ip,
                userAgent: req.get('user-agent') || '',
                expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
            })

            // Dedupe per device (same as login): revoke older active sessions of
            // this user from the SAME device (same IP + user agent) so updating
            // the account does not leave a stale "double" session behind.
            // Different devices stay logged in.
            await revokeDuplicateDeviceSessions({
                userId,
                ip,
                userAgent: req.get('user-agent') || '',
                exceptJti: newJti,
                revokedBy: user.username,
            })
        } catch (err) {
            console.error('❌ Failed to re-create session on account update:', err.message)
        }

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

        sendSuccess(res, { user }, 'Profile updated')
    } catch (err) {
        console.error('Update account error:', err)
        sendError(res, 'Failed to update account')
    }
}

// ============================================================
// User Management (Admin only)
// ============================================================

/**
 * Check if only default superadmin user exists (fresh install)
 * Used by login page to show default credentials hint
 */
export const checkDefaultUser = async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT username, role FROM users ORDER BY id')
        const isDefaultOnly = rows.length === 1 && rows[0].username === 'superadmin' && rows[0].role === 'superadmin'
        sendSuccess(res, { isDefaultOnly, userCount: rows.length })
    } catch (err) {
        sendError(res, err.message)
    }
}

export const listUsers = async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, username, role, created_at FROM users ORDER BY id ASC'
        )
        sendSuccess(res, rows)
    } catch (err) {
        sendError(res, err.message)
    }
}

export const addUser = async (req, res) => {
    const { username, password, role = 'admin' } = req.body
    const ip = getClientIp(req)

    if (!username || !password) {
        return sendError(res, 'Username and password are required', 400)
    }
    if (password.length < 6) {
        return sendError(res, 'Password must be at least 6 characters', 400)
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

        sendSuccess(res, rows[0], '', 201)
    } catch (err) {
        if (err.code === '23505') {
            return sendError(res, 'Username already exists', 409)
        }
        sendError(res, err.message)
    }
}

export const deleteUser = async (req, res) => {
    const { id } = req.params
    const ip = getClientIp(req)

    // Prevent self-deletion
    if (parseInt(id) === req.user.id) {
        return sendError(res, 'Cannot delete your own account', 400)
    }

    try {
        const { rows: userRows } = await pool.query('SELECT username FROM users WHERE id = $1', [id])
        const targetUser = userRows[0]
        if (!targetUser) return sendError(res, 'User not found', 404)

        // Prevent deleting the last user
        const { rows: countRows } = await pool.query('SELECT COUNT(*)::int as total FROM users')
        if (countRows[0].total <= 1) {
            return sendError(res, 'Cannot delete the last remaining user', 400)
        }

        await pool.query('DELETE FROM users WHERE id = $1', [id])
        await revokeAllUserSessions(parseInt(id, 10), null, req.user.username)

        await recordActivity({
            username: req.user.username,
            action: 'delete_user',
            category: 'auth',
            detail: `Deleted user: "${targetUser.username}"`,
            ip
        })

        sendSuccess(res, null, `User "${targetUser.username}" deleted`)
    } catch (err) {
        sendError(res, err.message)
    }
}

export const resetUserPassword = async (req, res) => {
    const { id } = req.params
    const { password } = req.body
    const ip = getClientIp(req)

    if (!password || password.length < 6) {
        return sendError(res, 'Password must be at least 6 characters', 400)
    }

    try {
        const { rows: userRows } = await pool.query('SELECT username FROM users WHERE id = $1', [id])
        const targetUser = userRows[0]
        if (!targetUser) return sendError(res, 'User not found', 404)

        const hashed = await bcrypt.hash(password, 10)
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, id])

        // Force logout all active sessions of the target user after a password reset
        const revoked = await revokeAllUserSessions(parseInt(id, 10), null, req.user.username)

        await recordActivity({
            username: req.user.username,
            action: 'reset_password',
            category: 'auth',
            detail: `Reset password for user: "${targetUser.username}"${revoked > 0 ? ` (${revoked} active session(s) ended)` : ''}`,
            ip
        })

        sendSuccess(res, null, `Password for "${targetUser.username}" has been reset`)
    } catch (err) {
        sendError(res, err.message)
    }
}

export const updateUserRole = async (req, res) => {
    const { id } = req.params
    const { role } = req.body
    const ip = getClientIp(req)

    const validRoles = ['superadmin', 'admin', 'viewer', 'public']
    if (!role || !validRoles.includes(role)) {
        return sendError(res, 'Invalid role. Must be one of: ' + validRoles.join(', '), 400)
    }

    try {
        const { rows: userRows } = await pool.query('SELECT username, role FROM users WHERE id = $1', [id])
        const targetUser = userRows[0]
        if (!targetUser) return sendError(res, 'User not found', 404)

        // Cannot change own role
        if (parseInt(id) === req.user.id) {
            return sendError(res, 'Cannot change your own role', 400)
        }

        await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, id])

        await recordActivity({
            username: req.user.username,
            action: 'update_user_role',
            category: 'auth',
            detail: `Changed role for user "${targetUser.username}" from "${targetUser.role}" to "${role}"`,
            ip
        })

        sendSuccess(res, { id: parseInt(id), username: targetUser.username, role }, `Role updated for "${targetUser.username}"`)
    } catch (err) {
        console.error('updateUserRole error:', err)
        sendError(res, err.message)
    }
}

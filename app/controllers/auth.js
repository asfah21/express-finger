import jwt from 'jsonwebtoken'
import { pool } from '../utils/database.js'

const SECRET = process.env.JWT_SECRET || 'express-finger-secret-key-123'

export const login = async (req, res) => {
    const { username, password } = req.body

    if (!username || !password) {
        return res.status(400).json({ status: 'error', message: 'Username and password are required' })
    }

    try {
        const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username])
        const user = rows[0]

        if (!user || user.password !== password) {
            return res.status(401).json({ status: 'error', message: 'Invalid username or password' })
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            SECRET,
            { expiresIn: '24h' }
        )

        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        })

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

export const logout = (req, res) => {
    res.clearCookie('token')
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

export const updateAccount = async (req, res) => {
    const { username, password } = req.body
    const userId = req.user.id

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
            sets.push(`password = $${params.length + 1}`)
            params.push(password)
        }

        query += sets.join(', ') + ` WHERE id = $${params.length + 1} RETURNING username, role`
        params.push(userId)

        const { rows } = await pool.query(query, params)

        // Re-generate token with new username if changed
        const user = rows[0]
        const token = jwt.sign(
            { id: userId, username: user.username, role: user.role },
            SECRET,
            { expiresIn: '24h' }
        )

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000
        })

        res.json({ status: 'success', message: 'Profile updated', data: { user } })
    } catch (err) {
        console.error('Update account error:', err)
        res.status(500).json({ status: 'error', message: 'Failed to update account' })
    }
}

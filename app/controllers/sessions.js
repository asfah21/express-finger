import jwt from 'jsonwebtoken'
import { config } from '../config/index.js'
import { pool } from '../utils/database.js'
import { sendSuccess, sendError } from '../utils/response.js'
import { recordActivity } from './activity-log.js'
import { getKioskDevice } from '../utils/kiosk-device.js'
import {
  listSessions,
  touchSession,
  revokeSession,
  revokeAllUserSessions,
  revokeOtherSessions,
  getSessionByJti,
  extendSessionExpiry,
} from '../utils/sessions.js'

const SECRET = process.env.JWT_SECRET

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || ''
}

export const sessionController = {
  /**
   * List active/known sessions (Super Admin only).
   * Response also includes summary counts (online / active) and the caller's
   * own jti so the UI can mark the current session.
   */
  async list(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 25, 500)
      const offset = Math.max(parseInt(req.query.offset) || 0, 0)
      const search = (req.query.search || '').trim()
      const status = (req.query.status || 'all').trim()

      const result = await listSessions({ limit, offset, search, status })

      sendSuccess(res, {
        total: result.total,
        limit,
        offset,
        has_more: offset + result.rows.length < result.total,
        online: result.online,
        active: result.active,
        current_jti: req.user?.jti || null,
        list: result.rows,
      })
    } catch (err) {
      console.error('❌ listSessions error:', err.message)
      sendError(res, 'Failed to list sessions', 500)
    }
  },

  /**
   * Force-logout a single session by its jti (Super Admin only).
   * A Super Admin cannot end their own current session from here.
   */
  async kill(req, res) {
    const { jti } = req.params
    const ip = getClientIp(req)
    const username = req.user?.username || 'api'

    if (!jti) return sendError(res, 'Session id (jti) is required', 400)

    // Prevent self-kill so a Super Admin cannot lock themselves out.
    if (jti === req.user?.jti) {
      return sendError(res, 'You cannot end your own active session', 400)
    }

    try {
      const revoked = await revokeSession(jti, username)
      if (!revoked) {
        return sendError(res, 'Session not found or already ended', 404)
      }

      await recordActivity({
        username,
        action: 'kill_session',
        category: 'auth',
        detail: `Force-logged out session of "${revoked.username}" (${revoked.role})`,
        ip,
      })

      sendSuccess(res, revoked, `Session for "${revoked.username}" has been ended`)
    } catch (err) {
      console.error('❌ killSession error:', err.message)
      sendError(res, 'Failed to end session', 500)
    }
  },

  /**
   * Force-logout all active sessions of a user (Super Admin only).
   * If the target is the caller's own account, the current session is kept.
   */
  async killAll(req, res) {
    const { userId } = req.params
    const ip = getClientIp(req)
    const username = req.user?.username || 'api'

    const uid = parseInt(userId, 10)
    if (!uid) return sendError(res, 'User id is required', 400)

    const exceptJti = uid === req.user?.id ? (req.user?.jti || null) : null

    try {
      const count = await revokeAllUserSessions(uid, exceptJti, username)
      if (count === 0) {
        return sendError(res, 'No active sessions found for this user', 404)
      }

      await recordActivity({
        username,
        action: 'kill_user_sessions',
        category: 'auth',
        detail: `Force-logged out ${count} active session(s) of user id ${uid}`,
        ip,
      })

      sendSuccess(res, { count, userId: uid }, `${count} session(s) ended`)
    } catch (err) {
      console.error('❌ killAllSessions error:', err.message)
      sendError(res, 'Failed to end sessions', 500)
    }
  },

  /**
   * Force-logout every active session except the caller's current one
   * (Super Admin only convenience action).
   */
  async killOthers(req, res) {
    const ip = getClientIp(req)
    const username = req.user?.username || 'api'
    const currentJti = req.user?.jti || null

    try {
      // End every active session except the caller's current one.
      const count = await revokeOtherSessions(currentJti, username)

      await recordActivity({
        username,
        action: 'kill_other_sessions',
        category: 'auth',
        detail: `Force-logged out ${count} other active session(s)`,
        ip,
      })

      sendSuccess(res, { count }, `${count} other session(s) ended`)
    } catch (err) {
      console.error('❌ killOtherSessions error:', err.message)
      sendError(res, 'Failed to end sessions', 500)
    }
  },

  /**
   * Heartbeat — any authenticated user pings this periodically so the
   * sessions page can show a real-time "online" status. A revoked session
   * is rejected here by the auth middleware (401), which the frontend uses
   * to force an immediate logout.
   *
   * For kiosk role 'public' the heartbeat is ALSO a device gate: if the bound
   * device was revoked / unbound / re-pended by an admin, the heartbeat is
   * rejected (403) so the kiosk is force-logged-out right away.
   */
  async heartbeat(req, res) {
    const jti = req.user?.jti
    if (!jti) return sendSuccess(res, { tracked: false }, 'ok')

    const user = req.user

    // Kiosk device gate — role 'public' must still come from an approved device
    // that is bound to this account. Revoked/pending/unbound devices are rejected.
    if (user?.role === 'public') {
      const deviceId = (req.headers?.[config.KIOSK_DEVICE_HEADER] || '').toString().trim()
      if (!deviceId) {
        return res.status(400).json({ status: 'error', code: 'DEVICE_REQUIRED', message: 'Kiosk device is not identified' })
      }
      const device = await getKioskDevice(deviceId)
      if (!device) {
        return res.status(403).json({ status: 'error', code: 'DEVICE_UNREGISTERED', message: 'Kiosk device is not registered' })
      }
      if (device.status === 'pending') {
        return res.status(403).json({ status: 'error', code: 'DEVICE_PENDING', message: 'Kiosk device is pending approval' })
      }
      if (device.status === 'revoked') {
        return res.status(403).json({ status: 'error', code: 'DEVICE_REVOKED', message: 'Kiosk device access has been revoked' })
      }
      if (device.user_id !== user.id) {
        return res.status(403).json({ status: 'error', code: 'DEVICE_BOUND_OTHER', message: 'Kiosk device is bound to another account' })
      }
      // Keep the device's last_seen fresh (light write; fine on every beat).
      try {
        await pool.query('UPDATE kiosk_devices SET last_seen = now() WHERE device_id = $1', [deviceId])
      } catch (err) {
        console.error('❌ update kiosk_devices last_seen error:', err.message)
      }
    }

    const ok = await touchSession(jti)

    // Sliding renewal — hanya untuk role kiosk (mis. 'public') yang dikonfigurasi.
    // RENEWAL AGGRESSIVE: setiap heartbeat untuk role sliding langsung
    // memperpanjang expires_at di DB dan menerbitkan ulang JWT dengan `jti` yang
    // SAMA (identitas session tidak berubah). Selama kiosk online + heartbeat
    // berjalan, session tidak akan pernah kadaluarsa dan tidak perlu login ulang.
    let renewed = false
    if (
      ok &&
      user &&
      config.SLIDING_SESSION_ROLES.includes(user.role) &&
      typeof user.exp === 'number' &&
      SECRET
    ) {
      const ttlMs = user.role === 'public'
        ? config.PUBLIC_SESSION_TTL_MS
        : config.SLIDING_SESSION_TTL_MS
      try {
        const newExpMs = Date.now() + ttlMs
        const token = jwt.sign(
          { id: user.id, username: user.username, role: user.role, jti },
          SECRET,
          { algorithm: 'HS256', expiresIn: Math.ceil(ttlMs / 1000) }
        )
        // Konsisten dengan cookie login (controllers/auth.js): secure mengikuti
        // protokol aktual agar tetap bekerja di HTTP LAN dan HTTPS prod.
        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'
        res.cookie('token', token, {
          httpOnly: true,
          secure: isSecure,
          sameSite: isSecure ? 'none' : 'lax',
          path: '/',
          maxAge: ttlMs
        })
        renewed = await extendSessionExpiry(jti, new Date(newExpMs))
      } catch (err) {
        console.error('❌ Heartbeat sliding renewal error:', err.message)
      }
    }

    const session = await getSessionByJti(jti)

    sendSuccess(res, {
      tracked: ok,
      renewed,
      username: session?.username || user?.username,
      last_seen: session?.last_seen || new Date().toISOString(),
    })
  },
}

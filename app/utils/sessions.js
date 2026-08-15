import { LRUCache } from 'lru-cache'
import { pool } from './database.js'

// ============================================================
// Active Session Store
// ============================================================
// Each login issues a JWT that carries a unique `jti` claim. Every such token
// is tracked in the `user_sessions` table so a Super Admin can see who is
// online and force-logout (revoke) any session.
//
// The middleware uses isSessionActive() to reject revoked/expired sessions.
// To avoid a DB query on every authenticated request, we keep a short-lived
// cache of the decision. The DB remains the source of truth, so a revoked
// session stays revoked even if the cache is evicted.

const ACTIVE_TTL = 10 * 1000        // 10s — force logout takes effect quickly
const REVOKED_TTL = 10 * 60 * 1000  // 10min — remember "killed" tokens

const sessionCache = new LRUCache({
  max: 2000,
  ttl: REVOKED_TTL,
  updateAgeOnGet: false,
})

const SESSION_RETENTION_DAYS = 7

function cacheKeyActive(jti) { return `active:${jti}` }
function cacheKeyRevoked(jti) { return `revoked:${jti}` }

// ============================================================
// Public API
// ============================================================

/**
 * Register a newly issued JWT as an active session.
 * @returns {Promise<object|null>} the inserted row, or null on failure.
 */
export async function createSession({ jti, userId, username, role, ip = '', userAgent = '', expiresAt }) {
  if (!jti || !userId || !expiresAt) return null
  try {
    const { rows } = await pool.query(
      `INSERT INTO user_sessions (jti, user_id, username, role, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, jti, username, role, created_at, expires_at`,
      [jti, userId, username, role, ip || '', userAgent || '', expiresAt]
    )
    sessionCache.set(cacheKeyActive(jti), true, { ttl: ACTIVE_TTL })
    return rows[0]
  } catch (err) {
    console.error('❌ createSession error:', err.message)
    return null
  }
}

/**
 * Update the last_seen heartbeat for a session. Returns true when the
 * session still exists and is active.
 */
export async function touchSession(jti) {
  if (!jti) return false
  try {
    const { rowCount } = await pool.query(
      `UPDATE user_sessions SET last_seen = now()
       WHERE jti = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [jti]
    )
    if (rowCount > 0) {
      sessionCache.set(cacheKeyActive(jti), true, { ttl: ACTIVE_TTL })
      return true
    }
    return false
  } catch (err) {
    console.error('❌ touchSession error:', err.message)
    return false
  }
}

/**
 * Decide whether a JWT is still allowed to act.
 * - explicitly revoked  -> false
 * - expired            -> false
 * - active row present -> true
 * - no row (legacy token minted before session tracking) -> true
 *   (backward compatibility: we only block sessions we can prove are dead)
 */
export async function isSessionActive(jti) {
  if (!jti) return true

  if (sessionCache.has(cacheKeyRevoked(jti))) return false
  if (sessionCache.get(cacheKeyActive(jti))) return true

  try {
    const { rows } = await pool.query(
      'SELECT revoked_at, expires_at FROM user_sessions WHERE jti = $1',
      [jti]
    )
    const s = rows[0]
    if (!s) {
      // Legacy token: allow but keep a short cache so repeated calls are cheap.
      sessionCache.set(cacheKeyActive(jti), true, { ttl: ACTIVE_TTL })
      return true
    }
    if (s.revoked_at || s.expires_at <= new Date()) {
      sessionCache.set(cacheKeyRevoked(jti), true, { ttl: REVOKED_TTL })
      sessionCache.delete(cacheKeyActive(jti))
      return false
    }
    sessionCache.set(cacheKeyActive(jti), true, { ttl: ACTIVE_TTL })
    return true
  } catch (err) {
    console.error('❌ isSessionActive error:', err.message)
    // Fail-open on DB errors so a DB hiccup does not lock everyone out.
    return true
  }
}

/**
 * Force-logout a single session. Returns the revoked row (or null).
 */
export async function revokeSession(jti, revokedBy = '') {
  if (!jti) return null
  try {
    const { rows } = await pool.query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_by = $2
       WHERE jti = $1 AND revoked_at IS NULL
       RETURNING id, jti, user_id, username, role, revoked_at, revoked_by`,
      [jti, revokedBy || null]
    )
    if (rows.length > 0) {
      sessionCache.set(cacheKeyRevoked(jti), true, { ttl: REVOKED_TTL })
      sessionCache.delete(cacheKeyActive(jti))
    }
    return rows[0] || null
  } catch (err) {
    console.error('❌ revokeSession error:', err.message)
    return null
  }
}

/**
 * Force-logout all active sessions for a user, optionally keeping one jti.
 * @returns {Promise<number>} number of revoked sessions.
 */
export async function revokeAllUserSessions(userId, exceptJti = null, revokedBy = '') {
  try {
    const params = [revokedBy || null, userId]
    let exceptSql = ''
    if (exceptJti) {
      params.push(exceptJti)
      exceptSql = `AND jti <> $${params.length}`
    }
    const { rows } = await pool.query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_by = $1
       WHERE user_id = $2 AND revoked_at IS NULL ${exceptSql}
       RETURNING jti`,
      params
    )
    for (const r of rows) {
      sessionCache.set(cacheKeyRevoked(r.jti), true, { ttl: REVOKED_TTL })
      sessionCache.delete(cacheKeyActive(r.jti))
    }
    return rows.length
  } catch (err) {
    console.error('❌ revokeAllUserSessions error:', err.message)
    return 0
  }
}

/**
 * Force-logout every active session except the caller's current one.
 * When currentJti is null (e.g. an API-key caller with no session), all
 * active sessions are ended.
 * @returns {Promise<number>} number of revoked sessions.
 */
export async function revokeOtherSessions(currentJti = null, revokedBy = '') {
  try {
    const params = [revokedBy || null]
    let exceptSql = '1=1'
    if (currentJti) {
      params.push(currentJti)
      exceptSql = `jti <> $${params.length}`
    }
    const { rows } = await pool.query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_by = $1
       WHERE revoked_at IS NULL AND ${exceptSql}
       RETURNING jti`,
      params
    )
    for (const r of rows) {
      sessionCache.set(cacheKeyRevoked(r.jti), true, { ttl: REVOKED_TTL })
      sessionCache.delete(cacheKeyActive(r.jti))
    }
    return rows.length
  } catch (err) {
    console.error('❌ revokeOtherSessions error:', err.message)
    return 0
  }
}

/**
 * Compute a human-friendly status for a session row.
 */
export function computeSessionStatus(row, now = new Date()) {
  if (!row) return 'unknown'
  if (row.revoked_at) return 'ended'
  if (row.expires_at && row.expires_at <= now) return 'expired'
  const lastSeen = row.last_seen || row.created_at
  const ageMs = now - new Date(lastSeen).getTime()
  if (ageMs <= 90 * 1000) return 'online'
  if (ageMs <= 10 * 60 * 1000) return 'away'
  return 'idle'
}

/**
 * List sessions with optional search + status filter.
 * @returns {Promise<{rows: object[], total: number, online: number, active: number}>}
 */
export async function listSessions({ limit = 25, offset = 0, search = '', status = '' } = {}) {
  const where = []
  const params = []
  let i = 1

  if (search) {
    params.push(`%${search}%`)
    where.push(`(username ILIKE $${i} OR role ILIKE $${i} OR ip_address ILIKE $${i})`)
    i++
  }
  if (status && status !== 'all') {
    // Status is computed after fetch; only 'ended' and 'expired' map directly to SQL.
    if (status === 'ended') {
      where.push('revoked_at IS NOT NULL')
    } else if (status === 'expired') {
      where.push('revoked_at IS NULL AND expires_at <= now()')
    } else {
      // online / away / idle are relative to now(); do the filtering in JS.
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const now = new Date()

  const [dataRes, countRes] = await Promise.all([
    pool.query(
      `SELECT id, jti, user_id, username, role, ip_address, user_agent, created_at, last_seen, expires_at, revoked_at, revoked_by
       FROM user_sessions ${whereSql}
       ORDER BY (revoked_at IS NOT NULL) ASC, last_seen DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM user_sessions ${whereSql}`, params),
  ])

  const total = countRes.rows[0].total
  const rows = dataRes.rows.map(r => ({ ...r, status: computeSessionStatus(r, now) }))

  // Apply JS-side filter for relative statuses
  let filtered = rows
  if (status && !['ended', 'expired'].includes(status) && status !== 'all') {
    filtered = rows.filter(r => r.status === status)
  }

  // Counts are computed against the full table (not filtered page), so the
  // summary bar stays accurate regardless of search/pagination.
  const [onlineRes, activeRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS c FROM user_sessions
       WHERE revoked_at IS NULL AND expires_at > now() AND last_seen >= now() - interval '90 seconds'`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM user_sessions
       WHERE revoked_at IS NULL AND expires_at > now()`
    ),
  ])

  return {
    rows: filtered,
    total,
    online: onlineRes.rows[0].c,
    active: activeRes.rows[0].c,
  }
}

/**
 * Get a single session by jti (used by heartbeat to confirm the current session).
 */
export async function getSessionByJti(jti) {
  if (!jti) return null
  try {
    const { rows } = await pool.query(
      `SELECT id, jti, user_id, username, role, ip_address, created_at, last_seen, expires_at, revoked_at
       FROM user_sessions WHERE jti = $1`,
      [jti]
    )
    return rows[0] || null
  } catch (err) {
    console.error('❌ getSessionByJti error:', err.message)
    return null
  }
}

/**
 * Remove old session rows so the table never grows unbounded.
 */
export async function cleanupExpiredSessions() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM user_sessions
       WHERE expires_at < now() - ($1 * interval '1 day')
          OR (revoked_at IS NOT NULL AND revoked_at < now() - ($1 * interval '1 day'))`,
      [SESSION_RETENTION_DAYS]
    )
    if (rowCount > 0) {
      console.log(`🧹 Cleaned up ${rowCount} old/expired user sessions`)
    }
  } catch (err) {
    console.error('❌ cleanupExpiredSessions error:', err.message)
  }
}

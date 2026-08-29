import { LRUCache } from 'lru-cache'


// ============================================================
// Cache Configuration
// ============================================================

// Maximum number of entries in cache
const MAX_ENTRIES = 500

// Time-to-live for different data types (in seconds)
export const TTL = {
  SHORT: 15,       // 15 detik — untuk attendance logs, real-time data
  LOGS_LIST: 15,   // 15 detik — daftar log absensi (real-time), agar selalu fresh
  MEDIUM: 60,      // 1 menit — untuk list data yang cukup sering berubah
  LONG: 120,       // 2 menit — untuk data yang jarang berubah
  VERY_LONG: 300,  // 5 menit — untuk settings, konfigurasi statis
}

// ============================================================
// Cache Keys (digunakan sebagai prefix untuk buildCacheKey)
// ============================================================
export const CACHE_KEYS = {
  LOGS_LIST: 'logs:list',
  LOGS_DAILY_STATS: 'logs:daily',
  EMPLOYEE_LIST: 'emp:list',
  EMPLOYEES_LIST: 'emps:list',
  EMPLOYEE_DETAIL: 'emp:detail',
  EMPLOYEE_DEPARTMENTS: 'emp:departments',
  DEVICES_LIST: 'dev:list',
  SETTINGS: 'settings',
  ACTIVITY_LOGS_LIST: 'act:list',
  OVERVIEW_STATS: 'overview:stats',
  OVERVIEW_CHART: 'overview:chart',
  OVERVIEW_DEVICES: 'overview:devices',
  PAIR_SUMMARY: 'pair:summary',
}

// Cache patterns untuk invalidasi massal
export const CACHE_PATTERNS = {
  ATTENDANCE: ['logs:list', 'logs:daily', 'overview:stats', 'overview:chart', 'pair:summary'],
  EMPLOYEE: ['emp:list', 'emps:list', 'emp:detail', 'emp:departments'],
  DEVICE: ['dev:list', 'overview:devices'],
  SETTINGS: ['settings'],
  ACTIVITY: ['act:list'],
  OVERVIEW: ['overview:stats', 'overview:chart', 'overview:devices'],
}

// ============================================================
// Metrics
// ============================================================
export const cacheMetrics = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
  get hitRate() {
    const total = this.hits + this.misses
    return total === 0 ? 0 : (this.hits / total * 100).toFixed(1)
  },
  get total() {
    return this.hits + this.misses
  },
  reset() {
    this.hits = 0
    this.misses = 0
    this.sets = 0
    this.deletes = 0
  }
}

// ============================================================
// LRU Cache Instance
// ============================================================
const cache = new LRUCache({

  max: MAX_ENTRIES,
  ttl: TTL.MEDIUM * 1000, // default TTL dalam ms
  allowStale: false,
  updateAgeOnGet: true,    // LRU: akses memperbarui usia entry
  updateAgeOnHas: false,
  noDisposeOnSet: false,
})

// ============================================================
// Public API
// ============================================================

/**
 * Build a consistent cache key from parts
 * @param  {...any} parts - Key parts to join with ':'
 * @returns {string}
 */
export function buildCacheKey(...parts) {
  return parts.filter(p => p !== undefined && p !== null && p !== '').join(':')
}

/**
 * Get a value from cache
 * @param {string} key
 * @returns {any|undefined}
 */
export function getCache(key) {
  const value = cache.get(key)
  if (value !== undefined) {
    cacheMetrics.hits++
    return value
  }
  cacheMetrics.misses++
  return undefined
}

/**
 * Set a value in cache
 * @param {string} key
 * @param {any} value
 * @param {number} ttlSeconds - TTL in seconds (optional, uses default if not provided)
 */
export function setCache(key, value, ttlSeconds) {
  cacheMetrics.sets++
  if (ttlSeconds !== undefined) {
    cache.set(key, value, { ttl: ttlSeconds * 1000 })
  } else {
    cache.set(key, value)
  }
}

/**
 * Delete a single cache key
 * @param {string} key
 */
export function delCache(key) {
  cacheMetrics.deletes++
  cache.delete(key)
}

/**
 * Delete all cache keys matching a pattern (string with wildcard *)
 * Supports patterns like: 'emp:list*', 'logs:*', etc.
 * A pattern WITHOUT '*' is treated as a prefix, so 'logs:list' also
 * invalidates composite keys like 'logs:list:2026-08-29:25'.
 * @param {string} pattern - Pattern to match (e.g., 'emp:list*')
 * @returns {number} Number of deleted entries
 */
export function delCacheByPattern(pattern) {
  const source = pattern.includes('*')
    ? pattern.replace(/\*/g, '.*')
    : pattern + '.*'
  const regex = new RegExp('^' + source + '$')
  let deleted = 0

  for (const key of cache.keys()) {
    if (regex.test(key)) {
      cache.delete(key)
      cacheMetrics.deletes++
      deleted++
    }
  }

  return deleted
}

/**
 * Delete all cache keys matching multiple patterns
 * @param {string[]} patterns - Array of patterns
 * @returns {number} Number of deleted entries
 */
export function delCacheByPatterns(patterns) {
  let totalDeleted = 0
  for (const pattern of patterns) {
    totalDeleted += delCacheByPattern(pattern)
  }
  return totalDeleted
}

/**
 * Get cache metrics for monitoring
 * @returns {object}
 */
export function getCacheMetrics() {
  return {
    ...cacheMetrics,
    size: cache.size,
    maxSize: MAX_ENTRIES,
    utilization: ((cache.size / MAX_ENTRIES) * 100).toFixed(1) + '%',
    keys: [...cache.keys()],
  }
}

/**
 * Clear all cache entries
 */
export function clearCache() {
  cache.clear()
  cacheMetrics.reset()
}

/**
 * Pre-warm cache with common data
 * Call this during server startup
 * @param {object} deps - Object with functions to call for warming
 */
export async function warmCache(deps = {}) {
  const { getOverviewStats, getOverviewChart, getSettingsData, getDevices } = deps
  const warmed = []

  try {
    // 1. Settings — data statis, TTL panjang
    if (typeof getSettingsData === 'function') {
      const settings = await getSettingsData()
      setCache(CACHE_KEYS.SETTINGS, settings, TTL.VERY_LONG)
      warmed.push('settings')
    }
  } catch (e) {
    console.warn(`⚠️ Cache warm: settings failed — ${e.message}`)
  }

  try {
    // 2. Overview stats — data dashboard
    if (typeof getOverviewStats === 'function') {
      const stats = await getOverviewStats()
      setCache(CACHE_KEYS.OVERVIEW_STATS, stats, TTL.SHORT)
      warmed.push('overview:stats')
    }
  } catch (e) {
    console.warn(`⚠️ Cache warm: overview stats failed — ${e.message}`)
  }

  try {
    // 3. Overview chart — data grafik
    if (typeof getOverviewChart === 'function') {
      const chart = await getOverviewChart()
      setCache(CACHE_KEYS.OVERVIEW_CHART, chart, TTL.SHORT)
      warmed.push('overview:chart')
    }
  } catch (e) {
    console.warn(`⚠️ Cache warm: overview chart failed — ${e.message}`)
  }

  try {
    // 4. Devices list — untuk dropdown/overview
    if (typeof getDevices === 'function') {
      const devices = await getDevices()
      setCache(CACHE_KEYS.OVERVIEW_DEVICES, devices, TTL.MEDIUM)
      warmed.push('overview:devices')
    }
  } catch (e) {
    console.warn(`⚠️ Cache warm: devices failed — ${e.message}`)
  }

  if (warmed.length > 0) {
    console.log(`🔥 Cache warmed: ${warmed.join(', ')}`)
  }

  return warmed
}

// ============================================================
// Periodic cleanup log (monitoring)
// ============================================================
setInterval(() => {
  const metrics = getCacheMetrics()
  console.log(
    `📊 Cache: ${metrics.size}/${metrics.maxSize} entries | ` +
    `Hits: ${metrics.hits} | Misses: ${metrics.misses} | ` +
    `Hit Rate: ${metrics.hitRate}% | Sets: ${metrics.sets} | Deletes: ${metrics.deletes}`
  )
}, 5 * 60 * 1000) // Setiap 5 menit

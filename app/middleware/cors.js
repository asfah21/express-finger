/**
 * CORS Middleware
 * 
 * Sistem ini berjalan di jaringan internal (LAN), sehingga:
 * - Semua origin diizinkan (termasuk IP lokal seperti 10.10.1.15:8080, 192.168.x.x, dll)
 * - CORS_ORIGINS hanya untuk logging/monitoring, bukan untuk blocking
 * - Tidak ada blocking origin karena ini sistem internal perusahaan
 */

export const corsMiddleware = (req, res, next) => {
  const origin = req.headers.origin
  
  // Allow semua origin - sistem internal
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Total-Count')
  res.setHeader('Access-Control-Max-Age', '86400') // 24 hours
  
  // Logging untuk monitoring (jika CORS_ORIGINS dikonfigurasi)
  if (origin && process.env.CORS_ORIGINS) {
    const allowedOrigins = process.env.CORS_ORIGINS.split(',')
      .map(s => s.trim())
      .filter(Boolean)
    
    if (!allowedOrigins.includes(origin)) {
      console.log(`ℹ️ [CORS] Origin not in CORS_ORIGINS (but allowed): ${origin}`)
    }
  }
  
  // Handle preflight
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  
  next()
}

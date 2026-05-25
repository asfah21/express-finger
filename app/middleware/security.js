// Security headers middleware
export const securityMiddleware = (req, res, next) => {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff')
  
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY')
  
  // Control referrer information
  res.setHeader('Referrer-Policy', 'no-referrer')
  
  // Enable XSS filter in older browsers
  res.setHeader('X-XSS-Protection', '1; mode=block')
  
  // Content Security Policy - restricts what resources can be loaded
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
    "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com data:; " +
    "img-src 'self' data:; " +
    "connect-src 'self' ws: wss: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;"
  )
  
  // HTTP Strict Transport Security (only if HTTPS)
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  
  // Permissions Policy - restrict browser features
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  )
  
  // Prevent serving cached pages after logout (for HTML pages only)
  // API responses can be cached by the server-side cache module
  if (req.path.endsWith('.html') || req.path === '/' || req.accepts('text/html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }
  // For API responses, allow server-side caching (Cache-Control is set per-endpoint)

  
  next()
}

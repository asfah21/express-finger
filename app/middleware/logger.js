// Logger middleware
export const loggerMiddleware = (req, _res, next) => {
  if (req.path.startsWith('/api/logs') || req.path.startsWith('/api/stats')) return next()
  const len = typeof req.body === 'string'
    ? req.body.length
    : (typeof req.body === 'object' && req.body ? JSON.stringify(req.body).length : 0)
  console.log(`➡️ ${req.method} ${req.url} | ip=${req.ip} | len=${len}`)
  next()
}
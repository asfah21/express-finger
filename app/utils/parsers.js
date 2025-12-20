// Parsing functions
export function parseUrlencodedObject(obj, q = {}) {
  return [{
    uid: obj?.UID ?? obj?.uid ?? q.UID ?? q.uid,
    userId: obj?.USERID ?? obj?.userId ?? obj?.PIN ?? obj?.pin ?? q.USERID ?? q.PIN ?? q.pin,
    timestamp: obj?.CHECKTIME ?? obj?.DateTime ?? obj?.timestamp ?? obj?.time ?? q.CHECKTIME ?? q.DateTime,
    type: obj?.VERIFYMODE ?? obj?.Verified ?? obj?.type ?? obj?.Status ?? q.VERIFYMODE ?? q.Verified ?? q.Status,
  }]
}

export function parseAmpString(s, q = {}) {
  const map = {}
  s.split('&').forEach(p => {
    const [k, v] = p.split('=')
    if (!k) return
    map[k.trim()] = decodeURIComponent((v || '').trim())
  })
  return [{
    uid: map.UID || map.uid || q.UID || q.uid,
    userId: map.USERID || map.userId || map.PIN || map.pin || q.USERID || q.PIN || q.pin,
    timestamp: map.CHECKTIME || map.DateTime || map.timestamp || map.time || q.CHECKTIME || q.DateTime,
    type: map.VERIFYMODE || map.Verified || map.type || map.Status || q.VERIFYMODE || q.Verified || q.Status
  }]
}

export function parseKeyValueLines(s) {
  const rows = []
  const lines = s.split(/\r?\n/)
  for (const line of lines) {
    if (!/PIN=|USERID=/.test(line)) continue
    const get = re => (line.match(re) || [])[1]
    const r = {
      uid: get(/UID=([^\s\t\r\n]+)/i),
      userId: get(/(?:USERID|PIN)=([^\s\t\r\n]+)/i),
      timestamp: get(/(?:CHECKTIME|DateTime|TIME)=([0-9\-: ]{10,19})/i),
      type: get(/(?:VERIFYMODE|Verified|Status|TYPE)=(\d+)/i)
    }
    if (r.userId || r.timestamp) rows.push(r)
  }
  return rows
}

export function parseWhitespaceATTLOG(s) {
  const rows = []
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const m = line.match(/^\s*(\S+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\d+)/)
    if (!m) continue
    const [, pin, dt, verified] = m
    rows.push({ userId: pin, timestamp: dt, type: Number(verified) })
  }
  return rows
}

export function smartParseMany(req) {
  const url = new URL(req.url, 'http://x')
  const q = Object.fromEntries(url.searchParams.entries())
  
  if ((req.headers['content-type'] || '').includes('application/x-www-form-urlencoded') &&
      typeof req.body === 'object' && req.body) {
    return parseUrlencodedObject(req.body, q)
  }
  
  if (typeof req.body === 'string') {
    if (req.body.includes('=') && req.body.includes('&')) {
      const rows = parseAmpString(req.body, q)
      if (rows.some(r => r.userId || r.timestamp)) return rows
    }
    if (/PIN=|USERID=/.test(req.body)) {
      const rows = parseKeyValueLines(req.body)
      if (rows.length) return rows
    }
    const rows = parseWhitespaceATTLOG(req.body)
    if (rows.length) return rows
  }
  
  const fallback = {
    uid: q.UID || q.uid,
    userId: q.USERID || q.PIN || q.pin,
    timestamp: q.CHECKTIME || q.DateTime,
    type: q.VERIFYMODE || q.Verified || q.Status
  }
  
  return (fallback.userId || fallback.timestamp) ? [fallback] : []
}
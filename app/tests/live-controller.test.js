function isDuplicateWithinWindow(row, fid, type, now, windowMs = 60_000) {
    return String(row.user_id) === String(fid) && Number(row.type) === Number(type) &&
        now - new Date(row.timestamp).getTime() >= 0 && now - new Date(row.timestamp).getTime() < windowMs
}

test('live attendance duplicate rule blocks the same fid and type within one minute', () => {
    const row = { user_id: '12', type: 0, timestamp: '2026-08-07T08:00:00+08:00' }
    expect(isDuplicateWithinWindow(row, '12', 0, new Date('2026-08-07T08:00:59+08:00').getTime())).toBe(true)
})

test('live attendance duplicate rule allows the same type after one minute', () => {
    const row = { user_id: '12', type: 0, timestamp: '2026-08-07T08:00:00+08:00' }
    expect(isDuplicateWithinWindow(row, '12', 0, new Date('2026-08-07T08:01:00+08:00').getTime())).toBe(false)
})

test('live attendance duplicate rule allows a different attendance type immediately', () => {
    const row = { user_id: '12', type: 1, timestamp: '2026-08-06T17:00:00+08:00' }
    expect(isDuplicateWithinWindow(row, '12', 0, new Date('2026-08-06T17:00:01+08:00').getTime())).toBe(false)
})

function isDuplicateForDate(row, fid, type, date) {
    return String(row.user_id) === String(fid) && Number(row.type) === Number(type) && row.timestamp.startsWith(date)
}

test('live attendance duplicate rule blocks the same fid and type on the same calendar date', () => {
    const row = { user_id: '12', type: 0, timestamp: '2026-08-07T08:00:00+08:00' }
    expect(isDuplicateForDate(row, '12', 0, '2026-08-07')).toBe(true)
})

test('live attendance duplicate rule allows a different attendance type on the same date', () => {
    const row = { user_id: '12', type: 0, timestamp: '2026-08-07T08:00:00+08:00' }
    expect(isDuplicateForDate(row, '12', 1, '2026-08-07')).toBe(false)
})

test('live attendance duplicate rule allows the same type on a different date', () => {
    const row = { user_id: '12', type: 1, timestamp: '2026-08-06T17:00:00+08:00' }
    expect(isDuplicateForDate(row, '12', 1, '2026-08-07')).toBe(false)
})

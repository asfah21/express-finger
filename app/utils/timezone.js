export const BUSINESS_TIME_ZONE = 'Asia/Makassar'

export function getBusinessDateString(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: BUSINESS_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date)
}

export function getBusinessDateBounds(dateString) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString))
    if (!match) throw new Error(`Invalid business date: ${dateString}`)

    const [, year, month, day] = match
    return {
        from: new Date(`${year}-${month}-${day}T00:00:00+08:00`),
        to: new Date(`${year}-${month}-${day}T23:59:59.999+08:00`)
    }
}

export function formatBusinessTimestamp(value, options = {}) {
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: BUSINESS_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        ...options
    }).format(new Date(value))
}

export function toDeviceTimestamp(value) {
    if (value instanceof Date) return new Date(value.getTime())
    if (typeof value !== 'string') return new Date(value)
    const normalized = value.trim()
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return new Date(normalized)
    return new Date(normalized.replace(' ', 'T') + '+08:00')
}

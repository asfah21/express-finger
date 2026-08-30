// Mengikuti konvensi repo: pakai vitest globals (globals: true di vitest.config.js).
// JANGAN import dari 'vitest' — itu gagal di environment ini (lihat komentar di
// tests/live-attendance.test.js). Gunakan describe/it/expect/vi/beforeEach/afterEach
// yang di-inject sebagai global.
import { eventsController } from '../controllers/events.js'
import { attendanceBus } from '../utils/events.js'

function makeFakeRes() {
  const chunks = []
  let closeHandler = null
  const res = {
    writeHead: vi.fn(),
    write: vi.fn((chunk) => { chunks.push(String(chunk)) }),
    on: vi.fn((event, cb) => { if (event === 'close') closeHandler = cb }),
  }
  return { res, chunks, close: () => { if (closeHandler) closeHandler() } }
}

// Buka stream SSE dengan mock response; ditutup di afterEach agar tidak ada
// listener menggantung di event bus.
const openStreams = []
function openStream() {
  const fake = makeFakeRes()
  eventsController.stream({}, fake.res)
  openStreams.push(fake)
  return fake
}

describe('SSE events stream', () => {
  beforeEach(() => {
    // Isolasi antar test: bersihkan listener bus
    attendanceBus.removeAllListeners('attendance:new')
    attendanceBus.removeAllListeners('attendance:bulk')
  })

  afterEach(() => {
    while (openStreams.length) openStreams.pop().close()
  })

  it('sets SSE headers and sends the retry line', () => {
    const { res, chunks } = openStream()
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
    }))
    expect(chunks.join('')).toContain('retry: 3000')
  })

  it('writes an attendance:new frame when the bus emits', () => {
    const { chunks } = openStream()
    attendanceBus.emit('attendance:new', {
      id: 1,
      user_id: '5',
      nama: 'Test',
      type: 0,
      timestamp: '2026-08-30T00:00:00.000Z',
      device_sn: 'LIVE-CAM',
    })
    const out = chunks.join('')
    expect(out).toContain('event: attendance:new')
    expect(out).toContain('"user_id":"5"')
    expect(out).toContain('"type":0')
  })

  it('writes an attendance:bulk frame when the bus emits', () => {
    const { chunks } = openStream()
    attendanceBus.emit('attendance:bulk', { count: 3, source: 'pull' })
    const out = chunks.join('')
    expect(out).toContain('event: attendance:bulk')
    expect(out).toContain('"count":3')
  })

  it('detaches listeners when the connection closes', () => {
    const fake = openStream()
    expect(attendanceBus.listenerCount('attendance:new')).toBe(1)
    fake.close()
    expect(attendanceBus.listenerCount('attendance:new')).toBe(0)
  })
})

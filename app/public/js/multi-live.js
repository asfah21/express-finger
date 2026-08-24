// ─── Multi-Attendance kiosk (/multi_live.html) ──────────────────────────────
// Records attendance for a whole batch of employees (up to MAX_FACES) at once:
//   1. Live scan draws a green box per detected face (Shape Detection API).
//   2. When 1+ faces are stable, a 3→1 countdown runs in the centre of the
//      camera; at 0 the frame is captured and sent for multi-recognition.
//   3. A confirmation popup lists the recognised employees (name, FID, position)
//      with a remove (×) per row and a single global Masuk / Pulang / Cancel.
//   4. Submit records the chosen type for the whole batch in one request, then
//      returns straight to the kiosk home — no result screen.
//
// Camera state is deliberately self-contained here (mirrors /cam_live) so the
// existing single-scan page is never at risk of regression.

import { deviceHeaders, kioskDeviceErrorMessage } from './device.js'

const state = {
    initialized: false,
    stream: null,
    startPromise: null,
    busy: false, // a request is in flight (UI disabled)
    locked: false, // submission lock — double-submit guard
    pendingFaces: [], // recognised employees waiting for confirmation
    // Detection state
    detectionTimer: null,
    faceDetector: null, // cached FaceDetector (Shape Detection API)
    analysisCanvas: null,
    analysisCtx: null,
    lastFaceCount: -1,
    // Countdown state
    countdownTimer: null,
    countdownValue: 0,
    counting: false,
    // Idle / popup state
    idleTimer: null,
    popupIdleTimer: null,
    navigating: false,
    autoScanCount: 0 // consecutive auto-capture attempts with no recognised batch
}

const $ = (id) => document.getElementById(id)

// ─── Timing / budget ─────────────────────────────────────────────────────────
const DETECTION_INTERVAL_MS = 100 // analysis cadence (~10 fps, CPU friendly)
const COUNTDOWN_SECONDS = 3 // auto-capture countdown starting value shown in the camera centre
const COUNTDOWN_TICK_MS = 500 // per-step interval → total 3→1 countdown lasts 1.5s
const MAX_FACES = 5 // batch cap — also the max green boxes drawn
const REQUEST_TIMEOUT_MS = 15000 // client-side fetch timeout
const IDLE_TIMEOUT_MS = 90000 // kiosk: auto-return to /live.html when idle
const POPUP_IDLE_MS = 60000 // abandoned confirmation popup auto-cancels
const MAX_AUTO_SCANS = 2 // consecutive auto-captures before a manual "Scan Ulang" is required

function setStatus(message, tone = 'neutral') {
    const status = $('multi-live-status')
    if (!status) return
    status.textContent = message
    status.dataset.tone = tone
}

function setBusy(busy) {
    const retry = $('multi-live-retry')
    if (!retry) return
    retry.disabled = busy
    retry.setAttribute('aria-busy', String(busy))
}

function setScanLabel(isRetry) {
    const label = $('multi-live-retry-label')
    if (label) label.textContent = isRetry ? 'Scan Ulang' : 'Mulai Scan'
}

function camCompatibilityMessage() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        return window.isSecureContext === false
            ? 'Kamera membutuhkan HTTPS atau localhost. Buka aplikasi melalui alamat yang aman.'
            : 'Browser ini tidak mendukung kamera. Gunakan Chrome, Edge, Firefox, atau Safari versi terbaru.'
    }
    return null
}

function frameReady() {
    const video = $('multi-live-video')
    return Boolean(video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth >= 320 && video.videoHeight >= 240)
}

function captureImage() {
    const video = $('multi-live-video')
    const canvas = $('multi-live-canvas')
    if (!video?.videoWidth || !canvas) return null
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
}

async function postJSON(url, body) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...deviceHeaders() },
            body: JSON.stringify(body),
            signal: controller.signal
        })
        const data = await response.json().catch(() => ({}))
        // Kiosk device gate (403 DEVICE_*) is terminal — stop the kiosk with a
        // friendly message instead of silently rescanning forever.
        if (response.status === 403 && kioskDeviceErrorMessage(data.code)) {
            throw Object.assign(new Error(kioskDeviceErrorMessage(data.code)), { kioskDeviceError: true })
        }
        return data
    } finally {
        clearTimeout(timeout)
    }
}

// ─── Camera ──────────────────────────────────────────────────────────────────
async function startCam() {
    if (state.stream) return true
    if (state.startPromise) return state.startPromise
    const compatibilityError = camCompatibilityMessage()
    if (compatibilityError) {
        setStatus(compatibilityError, 'error')
        return false
    }
    const video = $('multi-live-video')
    if (!video) return false

    setStatus('Menghubungkan kamera…', 'processing')
    state.startPromise = (async () => {
        try {
            // Fast start: modest resolution first, then relax the constraints so
            // the browser can pick whatever it can provide.
            const constraints = [
                { video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
                { video: { facingMode: 'user' }, audio: false },
                { video: true, audio: false }
            ]
            let lastError
            for (const request of constraints) {
                try {
                    state.stream = await navigator.mediaDevices.getUserMedia(request)
                    break
                } catch (error) {
                    lastError = error
                    if (!['OverconstrainedError', 'NotFoundError', 'TypeError'].includes(error?.name)) throw error
                }
            }
            if (!state.stream) throw lastError || new Error('Camera stream unavailable')

            video.srcObject = state.stream
            video.setAttribute('playsinline', '')
            video.muted = true
            await new Promise((resolve) => {
                if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return resolve()
                video.addEventListener('loadedmetadata', resolve, { once: true })
            })
            await video.play().catch((error) => {
                if (error?.name !== 'NotAllowedError') throw error
            })
            $('multi-live-camera-frame')?.classList.add('is-ready')
            return true
        } catch (error) {
            console.error('Camera access failed:', error)
            state.stream?.getTracks().forEach((track) => track.stop())
            state.stream = null
            $('multi-live-camera-frame')?.classList.remove('is-ready')
            setScanLabel(true)
            setStatus(error?.name === 'NotAllowedError'
                ? 'Izin kamera ditolak. Izinkan kamera pada pengaturan situs, lalu tekan tombol Scan Ulang.'
                : error?.name === 'NotFoundError'
                    ? 'Kamera tidak ditemukan pada perangkat ini.'
                    : 'Kamera tidak dapat diakses. Pastikan halaman dibuka melalui HTTPS atau localhost.', 'error')
            $('multi-live-retry')?.focus()
            return false
        } finally {
            state.startPromise = null
        }
    })()
    return state.startPromise
}

// ─── Client-side face detection ──────────────────────────────────────────────
function analysisCanvas() {
    if (!state.analysisCanvas) {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 120
        state.analysisCanvas = canvas
        state.analysisCtx = canvas.getContext('2d', { willReadFrequently: true })
    }
    return state.analysisCanvas
}

async function detectFaces() {
    const video = $('multi-live-video')
    if (typeof window.FaceDetector !== 'function') return { available: false, faces: [] }
    if (!state.faceDetector) {
        try {
            state.faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: MAX_FACES })
        } catch {
            state.faceDetector = null
            return { available: false, faces: [] }
        }
    }
    try {
        const faces = await state.faceDetector.detect(video)
        return { available: true, faces: Array.isArray(faces) ? faces : [] }
    } catch {
        return { available: false, faces: [] }
    }
}

// Lightweight frame analysis: reject blank frames and provide a skin-tone
// fallback for browsers without the Shape Detection API (no boxes there).
async function analyzeFrame() {
    const video = $('multi-live-video')
    if (!video?.videoWidth || !frameReady()) return { ready: false, skin: false }
    const canvas = analysisCanvas()
    const ctx = state.analysisCtx
    if (!ctx) return { ready: false, skin: false }
    const w = canvas.width
    const h = canvas.height
    try {
        ctx.drawImage(video, 0, 0, w, h)
        const { data } = ctx.getImageData(0, 0, w, h)
        let sum = 0
        let sumSq = 0
        const n = data.length / 4
        for (let i = 0; i < data.length; i += 4) {
            const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
            sum += l
            sumSq += l * l
        }
        const mean = sum / n
        const variance = sumSq / n - mean * mean
        const ready = variance > 100 && mean > 22

        let skin = 0
        let sampled = 0
        for (let y = 0; y < h; y += 2) {
            for (let x = 0; x < w; x += 2) {
                const i = (y * w + x) * 4
                const r = data[i]
                const g = data[i + 1]
                const b = data[i + 2]
                sampled++
                if (r > 40 && g > 25 && b > 12 && r > g && r > b && (Math.max(r, g, b) - Math.min(r, g, b)) > 8) skin++
            }
        }
        return { ready, skin: sampled ? skin / sampled > 0.02 : false }
    } catch {
        return { ready: false, skin: false }
    }
}

// Draw one green box per detected face (max MAX_FACES), mirroring the video's
// CSS `scaleX(-1)` so boxes sit on the faces as displayed. Coordinates come
// from the Shape Detection API in the (unmirrored) source frame space.
function drawFaceBoxes(faces) {
    const overlay = $('multi-face-overlay')
    const frame = $('multi-live-camera-frame')
    const video = $('multi-live-video')
    if (!overlay || !frame || !video?.videoWidth) return
    overlay.textContent = ''
    const ew = frame.clientWidth
    const eh = frame.clientHeight
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!ew || !eh || !vw || !vh) return
    const scale = Math.max(ew / vw, eh / vh)
    const dw = vw * scale
    const dh = vh * scale
    const ox = (ew - dw) / 2
    const oy = (eh - dh) / 2
    faces.slice(0, MAX_FACES).forEach((face) => {
        const box = face.boundingBox
        if (!box || box.width <= 0 || box.height <= 0) return
        const w = box.width * scale
        const h = box.height * scale
        const left = ew - (box.x * scale + ox) - w // mirror X
        const top = box.y * scale + oy
        const div = document.createElement('div')
        div.className = 'multi-face-box'
        div.style.left = `${left}px`
        div.style.top = `${top}px`
        div.style.width = `${w}px`
        div.style.height = `${h}px`
        overlay.appendChild(div)
    })
}

// ─── Countdown (auto-capture) ────────────────────────────────────────────────
function renderCountdown() {
    const el = $('multi-countdown')
    if (!el) return
    if (state.counting) {
        el.textContent = String(state.countdownValue)
        el.classList.add('is-visible')
        el.setAttribute('aria-hidden', 'false')
    } else {
        el.classList.remove('is-visible')
        el.setAttribute('aria-hidden', 'true')
    }
}

function ensureCountdown() {
    if (state.counting || state.busy || state.locked) return
    state.counting = true
    state.countdownValue = COUNTDOWN_SECONDS
    renderCountdown()
    state.countdownTimer = setInterval(() => {
        state.countdownValue -= 1
        if (state.countdownValue <= 0) {
            stopCountdown()
            captureAndRecognize()
            return
        }
        renderCountdown()
    }, COUNTDOWN_TICK_MS)
}

function stopCountdown() {
    state.counting = false
    if (state.countdownTimer) {
        clearInterval(state.countdownTimer)
        state.countdownTimer = null
    }
    renderCountdown()
}

// ─── Detection loop ──────────────────────────────────────────────────────────
function stopDetection() {
    if (state.detectionTimer) {
        clearTimeout(state.detectionTimer)
        state.detectionTimer = null
    }
}

function scheduleNext() {
    state.detectionTimer = setTimeout(detectionLoop, DETECTION_INTERVAL_MS)
}

async function detectionLoop() {
    if (state.busy || state.locked || !state.stream) return
    const frame = await analyzeFrame()
    const detected = frame.ready ? await detectFaces() : { available: false, faces: [] }

    if (!frame.ready) {
        drawFaceBoxes([])
        stopCountdown()
    } else if (detected.available) {
        drawFaceBoxes(detected.faces)
        const count = detected.faces.length
        if (count !== state.lastFaceCount) {
            state.lastFaceCount = count
            stopCountdown()
        }
        if (count > 0) {
            armIdleRedirect()
            ensureCountdown()
        } else {
            stopCountdown()
        }
    } else if (frame.skin) {
        // Fallback path (no Shape Detection API): no boxes, countdown on any
        // skin presence so the kiosk still auto-captures.
        drawFaceBoxes([])
        armIdleRedirect()
        ensureCountdown()
    } else {
        drawFaceBoxes([])
        stopCountdown()
    }

    if (!state.busy && !state.locked && state.stream) scheduleNext()
}

function rearmScan() {
    stopDetection()
    stopCountdown()
    state.lastFaceCount = -1
    state.busy = false
    state.locked = false
    drawFaceBoxes([])
    setScanLabel(false)
    setBusy(false)
    armIdleRedirect()
    if (state.stream) scheduleNext()
}

// Limit consecutive auto-capture attempts: after MAX_AUTO_SCANS captures with no
// recognised batch, stop the detection loop and require a manual "Scan Ulang".
function noMatchRescan() {
    state.autoScanCount += 1
    if (state.autoScanCount >= MAX_AUTO_SCANS) {
        stopDetection()
        stopCountdown()
        drawFaceBoxes([])
        setScanLabel(true)
        setStatus('Tekan tombol Scan Ulang untuk memindai kembali.', 'warning')
        armIdleRedirect()
        $('multi-live-retry')?.focus()
        return
    }
    setStatus('Tidak ada wajah dikenali, memindai ulang…', 'warning')
    rearmScan()
}

// ─── Idle auto-return to kiosk home ──────────────────────────────────────────
function camReturnToKiosk() {
    if (state.navigating) return
    state.navigating = true
    window.location.assign('/live.html')
}

function camIdleTick() {
    state.idleTimer = null
    if (state.busy || state.locked || state.navigating) {
        armIdleRedirect()
        return
    }
    camReturnToKiosk()
}

function armIdleRedirect() {
    cancelIdleRedirect()
    if (state.busy || state.locked || state.navigating) return
    state.idleTimer = setTimeout(camIdleTick, IDLE_TIMEOUT_MS)
}

function cancelIdleRedirect() {
    if (state.idleTimer) {
        clearTimeout(state.idleTimer)
        state.idleTimer = null
    }
}

// ─── Capture + recognise ─────────────────────────────────────────────────────
async function captureAndRecognize() {
    if (state.busy || state.locked) return
    if (!await startCam()) return
    if (!frameReady()) {
        setStatus('Kamera aktif, tetapi gambar belum siap. Tekan tombol Scan Ulang untuk mencoba lagi.', 'warning')
        rearmScan()
        return
    }
    state.busy = true
    state.locked = true
    stopDetection()
    stopCountdown()
    drawFaceBoxes([])
    setBusy(true)
    setStatus('Memeriksa wajah…', 'processing')

    const image = captureImage()
    if (!image) {
        state.busy = false
        state.locked = false
        setBusy(false)
        setStatus('Kamera belum menghasilkan gambar yang jelas. Coba lagi.', 'error')
        rearmScan()
        return
    }

    try {
        const data = await postJSON('/api/live/multi-recognize', { image })
        state.busy = false
        state.locked = false
        setBusy(false)
        if (data.status === 'success') {
            const faces = (data.data && data.data.faces) || []
            if (faces.length === 0) {
                // No recognised employees in this frame — silently ignore the
                // unknown faces and start a fresh scan, per the design decision.
                noMatchRescan()
                return
            }
            openPopup(faces)
            return
        }
        // FACE_NOT_MATCHED (unknown / below threshold) → silently rescan.
        noMatchRescan()
    } catch (error) {
        console.error('Multi recognize request failed:', error)
        state.busy = false
        state.locked = false
        setBusy(false)
        if (error?.kioskDeviceError) {
            setStatus(error.message, 'error')
            return
        }
        setStatus(error?.name === 'AbortError'
            ? 'Permintaan memakan waktu terlalu lama. Periksa koneksi lalu coba lagi.'
            : 'Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.', 'error')
        rearmScan()
    }
}

// ─── Confirmation popup ──────────────────────────────────────────────────────
function openPopup(faces) {
    state.pendingFaces = faces
    state.autoScanCount = 0
    $('multi-list').hidden = false
    renderPopupList()
    const results = $('multi-dialog-results')
    if (results) {
        results.hidden = true
        results.textContent = ''
    }
    const dialog = $('multi-dialog')
    if (dialog && !dialog.open) {
        dialog.showModal()
        armPopupIdle()
    }
    cancelIdleRedirect()
    setStatus(`${faces.length} karyawan terdeteksi. Konfirmasi aksi pada jendela popup.`, 'success')
}

function renderPopupList() {
    const list = $('multi-list')
    const note = $('multi-dialog-note')
    if (!list) return
    list.textContent = ''
    let duplicateCount = 0
    state.pendingFaces.forEach((face, index) => {
        const li = document.createElement('li')
        li.className = 'multi-list-item'

        const meta = document.createElement('div')
        meta.className = 'multi-list-meta'
        const name = document.createElement('strong')
        name.textContent = face.nama || `FID ${face.fid}`
        const detail = document.createElement('small')
        detail.textContent = `FID ${face.fid}${face.jabatan ? ` · ${face.jabatan}` : ''}`
        meta.append(name, detail)

        // Warn about duplicates (same type within the last 5 minutes) so the
        // operator knows which employees will be skipped before submitting.
        const dupWarnings = []
        if (face.duplicateIn) dupWarnings.push('sudah absen MASUK')
        if (face.duplicateOut) dupWarnings.push('sudah absen PULANG')
        if (dupWarnings.length > 0) {
            duplicateCount += 1
            li.classList.add('is-duplicate')
            const warn = document.createElement('small')
            warn.className = 'multi-list-dup'
            warn.textContent = `⚠ Duplikat: ${dupWarnings.join(' & ')} (dalam 5 menit terakhir)`
            meta.append(warn)
        }

        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'multi-list-remove'
        remove.setAttribute('aria-label', `Hapus ${name.textContent} dari batch`)
        remove.textContent = '×'
        remove.addEventListener('click', () => {
            state.pendingFaces.splice(index, 1)
            renderPopupList()
            updateSubmitState()
            armPopupIdle()
        })

        li.append(meta, remove)
        list.appendChild(li)
    })
    if (note) {
        note.textContent = state.pendingFaces.length > 0
            ? duplicateCount > 0
                ? `Terdeteksi ${state.pendingFaces.length} karyawan, ${duplicateCount} duplikat (sudah absen) dan tidak akan dicatat.`
                : `Terdeteksi ${state.pendingFaces.length} karyawan. Tekan (X) untuk menghapus.`
            : 'Tidak ada karyawan yang dipilih. Tekan Cancel untuk kembali memindai.'
    }
    updateSubmitState()
}

function updateSubmitState() {
    const has = state.pendingFaces.length > 0
    const inBtn = $('multi-submit-in')
    const outBtn = $('multi-submit-out')
    if (inBtn) inBtn.disabled = !has
    if (outBtn) outBtn.disabled = !has
}

async function submitBatch(type) {
    if (state.pendingFaces.length === 0 || state.busy) return
    state.busy = true
    const inBtn = $('multi-submit-in')
    const outBtn = $('multi-submit-out')
    if (inBtn) inBtn.disabled = true
    if (outBtn) outBtn.disabled = true

    const fids = state.pendingFaces.map((face) => String(face.fid))
    try {
        await postJSON('/api/live/multi-attendance', { type, fids })
        state.busy = false
        // The operator already confirmed the action in the popup, so a
        // successful batch submit returns straight to the kiosk home instead
        // of showing a per-person result screen.
        $('multi-dialog')?.close()
        camReturnToKiosk()
    } catch (error) {
        console.error('Multi attendance submit failed:', error)
        state.busy = false
        $('multi-dialog')?.close()
        if (error?.kioskDeviceError) {
            setStatus(error.message, 'error')
            return
        }
        setStatus('Gagal menyimpan absensi. Periksa koneksi lalu coba lagi.', 'error')
        rearmScan()
    }
}

// ─── Popup idle (auto-cancel an abandoned confirmation) ──────────────────────
function armPopupIdle() {
    clearPopupIdle()
    state.popupIdleTimer = setTimeout(() => {
        state.popupIdleTimer = null
        $('multi-dialog')?.close()
    }, POPUP_IDLE_MS)
}

function clearPopupIdle() {
    if (state.popupIdleTimer) {
        clearTimeout(state.popupIdleTimer)
        state.popupIdleTimer = null
    }
}

function onDialogClose() {
    clearPopupIdle()
    stopCountdown()
    drawFaceBoxes([])
    rearmScan()
}

// ─── Cleanup / lifecycle ─────────────────────────────────────────────────────
function cleanup() {
    stopDetection()
    stopCountdown()
    cancelIdleRedirect()
    clearPopupIdle()
    if (state.stream) {
        state.stream.getTracks().forEach((track) => track.stop())
        state.stream = null
    }
}

export async function initMultiLivePage() {
    if (state.initialized) return
    state.initialized = true

    $('multi-live-retry')?.addEventListener('click', async () => {
        if (state.busy) return
        state.autoScanCount = 0
        if (!state.stream) {
            if (!(await startCam())) return
            setStatus('Maksimal 5 karyawan dalam satu frame.', 'ready')
        }
        rearmScan()
    })
    $('multi-cancel')?.addEventListener('click', () => $('multi-dialog')?.close())
    $('multi-submit-in')?.addEventListener('click', () => submitBatch(0))
    $('multi-submit-out')?.addEventListener('click', () => submitBatch(1))
    $('multi-dialog')?.addEventListener('close', onDialogClose)

    // Keyboard: Escape closes an open popup; otherwise returns to the kiosk.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return
        const dialog = $('multi-dialog')
        if (dialog?.open) {
            dialog.close()
        } else {
            event.preventDefault()
            window.location.assign('/live.html')
        }
    })

    // Any real interaction resets the idle auto-return countdown.
    ;['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'click'].forEach((eventName) => {
        document.addEventListener(eventName, armIdleRedirect, { passive: true })
    })

    window.addEventListener('pagehide', cleanup)

    if (await startCam()) {
        setStatus('Maksimal 5 karyawan dalam satu frame.', 'ready')
        rearmScan()
    } else {
        // A dead-end screen (camera denied / not found) still returns home.
        armIdleRedirect()
    }
}

window.initMultiLivePage = initMultiLivePage

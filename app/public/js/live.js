const state = { initialized: false }

const $ = (id) => document.getElementById(id)

// ─── Timing / budget ─────────────────────────────────────────────────────────
// Target: <3000ms from "face detected" to result. Face detection drives the
// capture; the only timers are a minimal stability debounce and hard
// fallback/timeout guards — never a blind "fire a shot" trigger.
const DETECTION_INTERVAL_MS = 100 // analysis cadence (~10 fps, CPU friendly)
const MIN_STABLE_MS = 150 // minimal debounce — NOT the old 300–500ms wait
const MOTION_THRESHOLD = 40 // very lenient mean-abs-grayscale-diff
const CAPTURE_BUDGET_MS = 1500 // fallback: force capture if a face lingers
const WATCHDOG_HINT_MS = 6000 // gentle hint when no face has been seen
const MAX_ATTEMPTS = 3 // 1 capture + up to 2 sequential auto-retries
const RETRY_DELAY_MS = 250 // backoff between attempts (not a trigger)
const REQUEST_TIMEOUT_MS = 15000 // client-side fetch timeout
const IDLE_TIMEOUT_MS = 90000 // kiosk: auto-return to /live.html after this long with no activity (1.5 min)
const IDLE_HINT_MS = 10000 // show a "returning to home" hint this long before the redirect

// On-screen face-guide geometry. Must stay in sync with .live-face-guide in
// css/live.css (inset: 12% 22%). Used to (1) pre-gate skin sampling to the box
// and (2) send the normalized box to the face service so it only considers the
// face inside the frame.
const GUIDE_INSET_X = 0.22
const GUIDE_INSET_Y = 0.12

const camState = {
    stream: null,
    startPromise: null,
    busy: false, // a request is in flight (UI is disabled)
    locked: false, // submission lock — double-submit guard
    submitted: false, // a successful attendance already completed this page
    retrying: false, // an auto-retry is scheduled — blocks new triggers
    initialized: false,
    type: Number(new URLSearchParams(window.location.search).get('type')),
    // Detection / attempt state
    detectionTimer: null,
    faceSince: null, // ms when the current continuous face streak started
    lastFaceSeen: null,
    hintShown: false,
    // Idle auto-return state
    idleTimer: null,
    idleHintTimer: null,
    idleHintShown: false,
    navigating: false,
    lastGray: null, // previous analysis frame for motion estimation
    attempts: 0, // recognition attempts in the current capture cycle
    faceDetector: null, // cached FaceDetector (Shape Detection API)
    analysisCanvas: null,
    analysisCtx: null
}

function setStatus(message, tone = 'neutral') {
    const status = $('live-status')
    if (!status) return
    status.textContent = message
    status.dataset.tone = tone
}

// ─── Audio notification sounds (asset files, no synthesis) ───────────────────
// Two kiosk sounds played from static files in /public/sounds:
//   • success — chime when attendance is recorded.
//   • error   — buzz when a 404 (face not recognized) is returned.
// The operator can swap the sounds by replacing the files in /public/sounds
// (keeping the same names) or by updating the SOUNDS map below.
// Autoplay: browsers block sound until a user gesture. The /live Masuk/Pulang
// click (same origin) normally unlocks it; as a fallback we also preload and
// flush any blocked sound on the first gesture inside the kiosk page.

const SOUNDS = {
    success: 'sounds/success.mp3',
    error: 'sounds/error.mp3'
}

const audioEls = {}
let audioUnlockArmed = false
let pendingSounds = []

function preloadSounds() {
    for (const [kind, url] of Object.entries(SOUNDS)) {
        if (!audioEls[kind]) {
            const audio = new Audio(url)
            audio.preload = 'auto'
            audio.load()
            audioEls[kind] = audio
        }
    }
}

function playSound(kind) {
    const url = SOUNDS[kind]
    if (!url) return
    const audio = audioEls[kind] || (audioEls[kind] = new Audio(url))
    audio.currentTime = 0
    const promise = audio.play()
    if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
            // Autoplay blocked — retry once audio is unlocked by a gesture.
            if (!pendingSounds.includes(kind)) pendingSounds.push(kind)
        })
    }
}

function flushPendingSounds() {
    const pending = pendingSounds
    pendingSounds = []
    for (const kind of pending) playSound(kind)
}

// Preload now and unlock audio on the first user gesture inside the kiosk page,
// so sounds play even if the page was opened directly (bookmark/browser restore).
function armAudioUnlock() {
    if (audioUnlockArmed) return
    audioUnlockArmed = true
    preloadSounds()
    ;['pointerdown', 'keydown', 'touchstart', 'click'].forEach((eventName) => {
        document.addEventListener(eventName, flushPendingSounds, { passive: true, once: true })
    })
}

export async function initLivePage() {
    if (state.initialized) return
    state.initialized = true
    document.querySelectorAll('[data-live-type]').forEach((button) => {
        button.addEventListener('click', () => {
            const type = Number(button.dataset.liveType)
            window.location.assign(`/cam_live.html?type=${type}`)
        })
    })
    document.querySelectorAll('[data-live-multi]').forEach((button) => {
        button.addEventListener('click', () => {
            window.location.assign('/multi_live.html')
        })
    })
    setStatus('Pilih Masuk, Pulang, atau Absensi Massal untuk melanjutkan.', 'neutral')
}

function camSetStatus(message, tone = 'neutral') {
    const status = $('cam-live-status')
    if (!status) return
    status.textContent = message
    status.dataset.tone = tone
}

function camSetBusy(busy) {
    const retry = $('cam-live-retry')
    if (!retry) return
    retry.disabled = busy
    retry.setAttribute('aria-busy', String(busy))
}

function camSetScanning(on) {
    const frame = $('cam-live-camera-frame')
    if (frame) frame.classList.toggle('is-scanning', on)
}

function camSetScanLabel(isRetry) {
    const label = $('cam-live-retry-label')
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

function camFrameReady() {
    const video = $('cam-live-video')
    return Boolean(video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth >= 320 && video.videoHeight >= 240)
}

function camImage() {
    const video = $('cam-live-video')
    const canvas = $('cam-live-canvas')
    if (!video?.videoWidth || !canvas) return null
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
}

async function startCam() {
    if (camState.stream) return true
    if (camState.startPromise) return camState.startPromise
    const compatibilityError = camCompatibilityMessage()
    if (compatibilityError) {
        camSetStatus(compatibilityError, 'error')
        return false
    }
    const video = $('cam-live-video')
    if (!video) return false

    camSetStatus('Menghubungkan kamera…', 'processing')
    camState.startPromise = (async () => {
        try {
            // Fast start: request a modest resolution first so the stream opens
            // quickly, then allow the browser to pick whatever it can provide.
            const constraints = [
                { video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
                { video: { facingMode: 'user' }, audio: false },
                { video: true, audio: false }
            ]
            let lastError
            for (const request of constraints) {
                try {
                    camState.stream = await navigator.mediaDevices.getUserMedia(request)
                    break
                } catch (error) {
                    lastError = error
                    if (!['OverconstrainedError', 'NotFoundError', 'TypeError'].includes(error?.name)) throw error
                }
            }
            if (!camState.stream) throw lastError || new Error('Camera stream unavailable')

            video.srcObject = camState.stream
            video.setAttribute('playsinline', '')
            video.muted = true
            await new Promise((resolve) => {
                if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return resolve()
                video.addEventListener('loadedmetadata', resolve, { once: true })
            })
            await video.play().catch((error) => {
                if (error?.name !== 'NotAllowedError') throw error
            })
            $('cam-live-camera-frame')?.classList.add('is-ready')
            camSetStatus('Kamera siap. Posisikan wajah di tengah bingkai.', 'ready')
            return true
        } catch (error) {
            console.error('Camera access failed:', error)
            camState.stream?.getTracks().forEach((track) => track.stop())
            camState.stream = null
            $('cam-live-camera-frame')?.classList.remove('is-ready')
            camSetScanLabel(true)
            camSetStatus(error?.name === 'NotAllowedError'
                ? 'Izin kamera ditolak. Izinkan kamera pada pengaturan situs, lalu tekan tombol Scan Ulang.'
                : error?.name === 'NotFoundError'
                    ? 'Kamera tidak ditemukan pada perangkat ini.'
                    : 'Kamera tidak dapat diakses. Pastikan halaman dibuka melalui HTTPS atau localhost.', 'error')
            $('cam-live-retry')?.focus()
            return false
        } finally {
            camState.startPromise = null
        }
    })()
    return camState.startPromise
}

// ─── Client-side face detection (no new dependencies, existing architecture) ──
// 1. Shape Detection API (FaceDetector) when the browser exposes it — this gives
//    an exact face count so we capture only when exactly one valid face is shown.
// 2. A lightweight skin-tone heuristic over the face-guide region as a fallback.
// The face service is never used as a detector — it only recognises + scores.

function analysisCanvas() {
    if (!camState.analysisCanvas) {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 120
        camState.analysisCanvas = canvas
        camState.analysisCtx = canvas.getContext('2d', { willReadFrequently: true })
    }
    return camState.analysisCanvas
}

async function detectWithApi(video) {
    if (typeof window.FaceDetector !== 'function') return { available: false, count: 0 }
    if (!camState.faceDetector) {
        try {
            camState.faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 })
        } catch (error) {
            camState.faceDetector = null
            return { available: false, count: 0 }
        }
    }
    try {
        const faces = await camState.faceDetector.detect(video)
        return { available: true, count: Array.isArray(faces) ? faces.length : 0 }
    } catch (error) {
        return { available: false, count: 0 }
    }
}

/**
 * Normalized guide-box in native video coordinates ([x1, y1, x2, y2] in 0..1).
 * Maps the on-screen box (drawn on top of the object-fit:cover-displayed video)
 * back to the raw camera frame the face service receives, so the "inside the
 * box" constraint matches what the employee sees on screen. Falls back to the
 * proportional insets when the layout cannot be resolved.
 */
function guideBoxNative() {
    const video = $('cam-live-video')
    const guide = $('cam-live-camera-frame')?.querySelector('.live-face-guide')
    const nativeW = video?.videoWidth
    const nativeH = video?.videoHeight
    if (!nativeW || !nativeH || !guide) {
        return [GUIDE_INSET_X, GUIDE_INSET_Y, 1 - GUIDE_INSET_X, 1 - GUIDE_INSET_Y]
    }
    const rect = video.getBoundingClientRect()
    const g = guide.getBoundingClientRect()
    if (!rect.width || !rect.height || !g.width || !g.height) {
        return [GUIDE_INSET_X, GUIDE_INSET_Y, 1 - GUIDE_INSET_X, 1 - GUIDE_INSET_Y]
    }
    // object-fit: cover — the native frame is scaled to cover the element,
    // centred, and any overflow is cropped equally on both sides.
    const scale = Math.max(rect.width / nativeW, rect.height / nativeH)
    const offsetX = (rect.width - nativeW * scale) / 2
    const offsetY = (rect.height - nativeH * scale) / 2
    const x1 = (g.left - rect.left - offsetX) / (nativeW * scale)
    const y1 = (g.top - rect.top - offsetY) / (nativeH * scale)
    const x2 = (g.right - rect.left - offsetX) / (nativeW * scale)
    const y2 = (g.bottom - rect.top - offsetY) / (nativeH * scale)
    return [
        Math.min(1, Math.max(0, x1)),
        Math.min(1, Math.max(0, y1)),
        Math.min(1, Math.max(0, x2)),
        Math.min(1, Math.max(0, y2))
    ]
}

function detectSkinFace(data, w, h) {
    // Sample the face-guide region only (matches the on-screen box, see
    // GUIDE_INSET_*). Tighter than the old 25–75% / 15–85% sampling so a
    // bystander standing beside the box can no longer satisfy the pre-gate.
    const x0 = Math.floor(w * GUIDE_INSET_X)
    const x1 = Math.floor(w * (1 - GUIDE_INSET_X))
    const y0 = Math.floor(h * GUIDE_INSET_Y)
    const y1 = Math.floor(h * (1 - GUIDE_INSET_Y))
    let skin = 0
    let region = 0
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * w + x) * 4
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            const maxc = Math.max(r, g, b)
            const minc = Math.min(r, g, b)
            region++
            if (r > 40 && g > 25 && b > 12 && r > g && r > b && (maxc - minc) > 8) skin++
        }
    }
    return region ? skin / region > 0.05 : false
}

function toGray(data) {
    const gray = new Float32Array(data.length / 4)
    for (let i = 0, g = 0; i < data.length; i += 4, g++) {
        gray[g] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
    return gray
}

function meanAbsDiff(gray, previous) {
    if (!previous || previous.length !== gray.length) return 0
    let diff = 0
    for (let i = 0; i < gray.length; i++) diff += Math.abs(gray[i] - previous[i])
    return diff / gray.length
}

/**
 * Analyze the current frame.
 * @returns {Promise<{ready: boolean, faceDetected: boolean, motion: number}>}
 */
async function analyzeFrame() {
    const video = $('cam-live-video')
    if (!video?.videoWidth || !camFrameReady()) return { ready: false, faceDetected: false, motion: 0 }

    const canvas = analysisCanvas()
    const ctx = camState.analysisCtx
    if (!ctx) return { ready: false, faceDetected: false, motion: 0 }
    const w = canvas.width
    const h = canvas.height
    try {
        ctx.drawImage(video, 0, 0, w, h)
        const { data } = ctx.getImageData(0, 0, w, h)

        // Reject blank/dark frames (camera still settling) so we never snapshot
        // a useless first frame.
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

        const gray = toGray(data)
        const motion = meanAbsDiff(gray, camState.lastGray)
        camState.lastGray = gray

        const skinDetected = detectSkinFace(data, w, h)
        const api = await detectWithApi(video)

        let faceDetected
        if (api.available) {
            // Exact single-face check when the API exists: capture only when
            // exactly one valid face is in front of the camera.
            faceDetected = api.count === 1
        } else {
            faceDetected = skinDetected
        }
        return { ready, faceDetected, motion }
    } catch (error) {
        return { ready: false, faceDetected: false, motion: 0 }
    }
}

// ─── Detection loop ───────────────────────────────────────────────────────────
// Self-scheduling (setTimeout after each analysis) so frames are never analysed
// concurrently. The loop is the only thing that can trigger a capture.

function resetDetection() {
    camState.faceSince = null
    camState.lastGray = null
}

function stopDetection() {
    if (camState.detectionTimer) {
        clearTimeout(camState.detectionTimer)
        camState.detectionTimer = null
    }
}

function scheduleNext() {
    camState.detectionTimer = setTimeout(detectionLoop, DETECTION_INTERVAL_MS)
}

async function detectionLoop() {
    if (camState.locked || camState.submitted || camState.retrying || !camState.stream) return
    const frame = await analyzeFrame()
    handleFrameResult(frame)
    if (!camState.locked && !camState.submitted && !camState.retrying && camState.stream) scheduleNext()
}

function handleFrameResult(frame) {
    const now = Date.now()
    if (!frame.ready) {
        resetDetection()
        return
    }
    if (frame.faceDetected) {
        camState.lastFaceSeen = now
        camState.hintShown = false
        // Any visible face counts as activity — reset the idle auto-return timer.
        armIdleRedirect()
        if (camState.faceSince == null) camState.faceSince = now
        const elapsed = now - camState.faceSince
        const still = frame.motion <= MOTION_THRESHOLD
        // Capture on the minimal stability debounce, or via the fallback budget
        // if the face lingers without ever settling (timer = fallback only).
        if ((still && elapsed >= MIN_STABLE_MS) || elapsed >= CAPTURE_BUDGET_MS) {
            resetDetection()
            captureAndSubmit()
        }
    } else {
        resetDetection()
        // Gentle guidance if no face has been seen for a while (informational
        // only — never a blind timed capture).
        if (!camState.hintShown && camState.lastFaceSeen != null && now - camState.lastFaceSeen >= WATCHDOG_HINT_MS) {
            camState.hintShown = true
            camSetStatus('Wajah tidak terdeteksi. Pastikan ruangan cukup terang dan wajah berada di tengah bingkai.', 'warning')
        }
    }
}

/**
 * Arm the automatic face-detection scan. Resets all attempt guards so a fresh
 * scan can run. Called once the camera is ready and again on "Scan Ulang".
 */
function armDetection() {
    stopDetection()
    camState.locked = false
    camState.busy = false
    camState.submitted = false
    camState.retrying = false
    camState.attempts = 0
    camSetBusy(false)
    resetDetection()
    camState.lastFaceSeen = Date.now()
    camState.hintShown = false
    camSetScanLabel(false)
    camSetScanning(true)
    camSetStatus('Memindai wajah. Posisikan wajah di tengah bingkai.', 'processing')
    scheduleNext()
    armIdleRedirect()
}

// ─── Idle auto-return to kiosk home ───────────────────────────────────────────
// A shared kiosk page left unattended (camera still streaming, detection loop
// still running) should return to /live.html by itself. The timer self-heals:
// if it fires while a request/scan is in flight, it re-arms instead of
// redirecting, so a real verification is never interrupted.

function camReturnToKiosk() {
    if (camState.navigating || camState.submitted) return
    camState.navigating = true
    window.location.assign('/live.html')
}

function camIdleHintTick() {
    camState.idleHintTimer = null
    if (camState.busy || camState.locked || camState.retrying || camState.submitted || camState.navigating) return
    camState.idleHintShown = true
    camSetStatus('Tidak ada aktivitas. Mengalihkan ke halaman utama…', 'warning')
}

function camIdleTick() {
    camState.idleTimer = null
    // Never interrupt an in-flight request, a retry, or the success result —
    // just re-arm and let it run again.
    if (camState.busy || camState.locked || camState.retrying || camState.submitted || camState.navigating) {
        armIdleRedirect()
        return
    }
    camReturnToKiosk()
}

function cancelIdleRedirect() {
    if (camState.idleTimer) {
        clearTimeout(camState.idleTimer)
        camState.idleTimer = null
    }
    if (camState.idleHintTimer) {
        clearTimeout(camState.idleHintTimer)
        camState.idleHintTimer = null
    }
    if (camState.idleHintShown) {
        camState.idleHintShown = false
        if (!camState.busy && !camState.locked && !camState.retrying && !camState.submitted) {
            camSetStatus('Memindai wajah. Posisikan wajah di tengah bingkai.', 'processing')
        }
    }
}

function armIdleRedirect() {
    cancelIdleRedirect()
    if (camState.busy || camState.locked || camState.retrying || camState.submitted || camState.navigating) return
    camState.idleTimer = setTimeout(camIdleTick, IDLE_TIMEOUT_MS)
    camState.idleHintTimer = setTimeout(camIdleHintTick, Math.max(0, IDLE_TIMEOUT_MS - IDLE_HINT_MS))
}

// ─── Capture + submit (single-shot, sequential auto-retry) ───────────────────

function endAttempt() {
    camState.locked = false
    camState.busy = false
    camSetBusy(false)
    camSetScanning(false)
    $('cam-live-capture')?.classList.remove('is-processing')
    // Re-arm the idle timer after a failed attempt so a dead-end error screen
    // still returns to the kiosk home. (No-op while retrying/submitted.)
    armIdleRedirect()
}

// Recognition failures worth retrying with a fresh frame: a 404 (no face or
// below-threshold confidence, but NOT "no reference faces" which is a data
// issue) and any 503 (face service unavailable / model still loading). Definitive
// answers (409 duplicate/order, 400) are never retried.
function shouldRetry(status, data) {
    if (status === 404 && data?.code === 'FACE_NOT_MATCHED' && data?.reason === 'no_reference_faces') return false
    return status === 404 || status === 503
}

// Schedule one more capture+submit after a short backoff. Strictly sequential:
// `retrying` blocks the button and the detection loop, so capture/recognition/
// submit can never run concurrently.
function scheduleRetry(message) {
    camState.retrying = true
    endAttempt()
    camSetStatus(message, 'processing')
    setTimeout(() => {
        camState.retrying = false
        captureAndSubmit()
    }, RETRY_DELAY_MS)
}

async function captureAndSubmit() {
    // Double-submit guard: loop + button + scheduled retries all funnel through
    // here, but only the first call while unlocked/busy is allowed to proceed.
    if (camState.locked || camState.busy || camState.submitted || camState.retrying) return
    if (!await startCam()) return
    if (!camFrameReady()) {
        camSetScanLabel(true)
        camSetStatus('Kamera aktif, tetapi gambar belum siap. Tekan tombol Scan Ulang untuk mencoba lagi.', 'warning')
        return
    }
    camState.attempts += 1
    camState.locked = true
    camState.busy = true
    stopDetection()
    camSetBusy(true)
    camSetScanning(true)
    camSetStatus(camState.type === 0 ? 'Memverifikasi wajah untuk absensi Masuk…' : 'Memverifikasi wajah untuk absensi Pulang…', 'processing')
    const image = camImage()
    if (!image) {
        endAttempt()
        camSetScanLabel(true)
        camSetStatus('Kamera belum menghasilkan gambar yang jelas. Posisikan wajah lalu tekan tombol Scan Ulang.', 'error')
        return
    }
    $('cam-live-capture')?.classList.add('is-processing')
    camSetStatus('Memeriksa wajah…', 'processing')
    try {
        // Client-side timeout so the status never hangs on a stalled network.
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        let response
        try {
            response = await fetch('/api/live/attendance', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: camState.type, image, box: guideBoxNative() }),
                signal: controller.signal
            })
        } finally {
            clearTimeout(timeout)
        }
        const data = await response.json().catch(() => ({}))
        if (response.ok) {
            camState.submitted = true
            endAttempt()
            showResult(data.data || {})
            return
        }
        if (shouldRetry(response.status, data) && camState.attempts < MAX_ATTEMPTS) {
            scheduleRetry('Wajah belum terbaca, mencoba lagi…')
            return
        }
        endAttempt()
        handleSubmissionError(response.status, data)
    } catch (error) {
        console.error('Attendance request failed:', error)
        if (camState.attempts < MAX_ATTEMPTS) {
            scheduleRetry('Koneksi terganggu, mencoba lagi…')
            return
        }
        endAttempt()
        camSetScanLabel(true)
        camSetStatus(error?.name === 'AbortError'
            ? 'Permintaan memakan waktu terlalu lama. Periksa koneksi lalu coba lagi.'
            : 'Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.', 'error')
    }
}

function showResult(result) {
    $('cam-live-result-name').textContent = result.nama || 'Karyawan'
    $('cam-live-result-userid').textContent = result.user_id != null ? String(result.user_id) : (result.fid || '-')
    $('cam-live-result-position').textContent = result.jabatan || '-'
    $('cam-live-result-label').textContent = camState.type === 0 ? 'Absensi masuk berhasil' : 'Absensi pulang berhasil'
    $('cam-live-result')?.classList.add('is-visible')
    $('cam-live-result')?.setAttribute('aria-hidden', 'false')
    camSetStatus('Wajah dikenali dan absensi berhasil dicatat.', 'success')
    playSound('success')
    // Generous redirect so the result is fully read (including by screen
    // readers) before returning to the kiosk for the next employee.
    setTimeout(() => window.location.assign('/live.html'), 2500)
}

function handleSubmissionError(status, data) {
    const code = data?.code
    const message = data?.message
    camSetScanLabel(true)
    if (status === 404) {
        camSetStatus(message || 'Wajah tidak dikenali. Pastikan wajah terang, terlihat penuh, dan berada di tengah, lalu tekan Scan Ulang.', 'error')
        playSound('error')
    } else if (status === 409) {
        camSetStatus(message || 'Absensi yang sama baru saja tercatat. Silakan coba lagi setelah 5 menit.', 'warning')
    } else if (status >= 500) {
        camSetStatus(message || 'Layanan pengenalan wajah sedang tidak tersedia. Coba lagi sebentar.', 'error')
    } else {
        camSetStatus(message || 'Verifikasi gagal. Atur posisi wajah lalu tekan Scan Ulang.', 'error')
    }
}

async function onRetryClick() {
    if (camState.locked || camState.busy || camState.submitted || camState.retrying) return
    if (!await startCam()) return
    armDetection()
}

function camCleanup() {
    stopDetection()
    cancelIdleRedirect()
    if (camState.stream) {
        camState.stream.getTracks().forEach((track) => track.stop())
        camState.stream = null
    }
}

export async function initCamLivePage() {
    if (camState.initialized) return
    camState.initialized = true
    camState.type = [0, 1].includes(camState.type) ? camState.type : 0
    const title = $('cam-live-title')
    if (title) {
        title.textContent = camState.type === 0 ? 'Absensi Masuk' : 'Absensi Pulang'
        // Green (default accent) for Masuk, yellow for Pulang.
        title.closest('.live-kicker')?.classList.toggle('is-out', camState.type !== 0)
    }
    $('cam-live-retry')?.addEventListener('click', onRetryClick)
    camSetScanLabel(false)

    // Keyboard access: Enter/Space triggers the scan button natively; Escape
    // returns to the kiosk so a shared terminal is never a dead end.
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault()
            window.location.assign('/live.html')
        }
    })

    // Any real interaction resets the idle auto-return countdown. Pure pointer
    // movement is intentionally excluded so an abandoned kiosk still returns home.
    ;['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'click'].forEach((eventName) => {
        document.addEventListener(eventName, armIdleRedirect, { passive: true })
    })

    // Preload + unlock the kiosk notification sounds on the first user gesture.
    armAudioUnlock()

    // Release the camera and stop scanning when the kiosk page is left.
    window.addEventListener('pagehide', camCleanup)

    if (await startCam()) {
        armDetection()
    } else {
        // Even a dead-end screen (camera denied / not found) returns to the
        // kiosk home instead of leaving the shared terminal stuck.
        armIdleRedirect()
    }
}

window.initLivePage = initLivePage
window.initCamLivePage = initCamLivePage

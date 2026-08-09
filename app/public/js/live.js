const state = { initialized: false }

const $ = (id) => document.getElementById(id)

const camState = {
    stream: null,
    startPromise: null,
    busy: false,
    initialized: false,
    autoSubmitTimer: null,
    type: Number(new URLSearchParams(window.location.search).get('type'))
}

function setStatus(message, tone = 'neutral') {
    const status = $('live-status')
    if (!status) return
    status.textContent = message
    status.dataset.tone = tone
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
    setStatus('Pilih Masuk atau Pulang untuk melanjutkan.', 'neutral')
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
            // Avoid strict min constraints: some browsers reject the whole request
            // even when a lower-resolution camera would work.
            const constraints = [
                { video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
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

async function submitCamAttendance() {
    if (camState.busy || !await startCam()) return
    if (!camFrameReady()) {
        camSetScanLabel(true)
        return camSetStatus('Kamera aktif, tetapi gambar belum siap. Tekan tombol Scan Ulang untuk mencoba lagi.', 'warning')
    }
    camState.busy = true
    camSetBusy(true)
    camSetScanning(true)
    camSetStatus(camState.type === 0 ? 'Memindai wajah untuk absensi Masuk…' : 'Memindai wajah untuk absensi Pulang…', 'processing')
    let response
    try {
        // Give the camera a moment to settle exposure/focus before the snapshot
        // so the first frame isn't dark or blurry (a common cause of 404s).
        await new Promise((resolve) => setTimeout(resolve, 600))
        const image = camFrameReady() ? camImage() : null
        if (!image) {
            camSetScanLabel(true)
            camSetStatus('Kamera belum menghasilkan gambar yang jelas. Posisikan wajah lalu tekan tombol Scan Ulang.', 'error')
            return
        }
        $('cam-live-capture')?.classList.add('is-processing')
        camSetStatus('Memeriksa wajah…', 'processing')
        // Client-side timeout so the status never hangs on a stalled network.
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 20000)
        try {
            response = await fetch('/api/live/attendance', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: camState.type, image }),
                signal: controller.signal
            })
        } finally {
            clearTimeout(timeout)
        }
        const data = await response.json().catch(() => ({}))
        if (response.ok) {
            $('cam-live-result-name').textContent = data.data?.nama || 'Karyawan'
            $('cam-live-result-label').textContent = camState.type === 0 ? 'Absensi masuk berhasil' : 'Absensi pulang berhasil'
            $('cam-live-result')?.classList.add('is-visible')
            $('cam-live-result')?.setAttribute('aria-hidden', 'false')
            camSetStatus('Wajah dikenali dan absensi berhasil dicatat.', 'success')
            // Generous redirect so the result is fully read (including by
            // screen readers) before returning to the kiosk for the next employee.
            setTimeout(() => window.location.assign('/live.html'), 4000)
        } else if (response.status === 404) {
            camSetScanLabel(true)
            camSetStatus('Wajah tidak dikenali. Pastikan wajah terang, terlihat penuh, dan berada di tengah, lalu tekan Scan Ulang.', 'error')
        } else if (response.status === 409) {
            camSetScanLabel(true)
            camSetStatus('Absensi yang sama baru saja tercatat. Silakan coba lagi setelah 1 menit.', 'warning')
        } else if (response.status >= 500) {
            camSetScanLabel(true)
            camSetStatus(data.message || 'Layanan pengenalan wajah sedang tidak tersedia. Coba lagi sebentar.', 'error')
        } else {
            camSetScanLabel(true)
            camSetStatus(data.message || 'Verifikasi gagal. Atur posisi wajah lalu tekan Scan Ulang.', 'error')
        }
    } catch (error) {
        console.error('Attendance request failed:', error)
        camSetScanLabel(true)
        camSetStatus(error?.name === 'AbortError'
            ? 'Permintaan memakan waktu terlalu lama. Periksa koneksi lalu coba lagi.'
            : 'Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.', 'error')
    } finally {
        camState.busy = false
        camSetBusy(false)
        camSetScanning(false)
        $('cam-live-capture')?.classList.remove('is-processing')
    }
}

export async function initCamLivePage() {
    if (camState.initialized) return
    camState.initialized = true
    camState.type = [0, 1].includes(camState.type) ? camState.type : 0
    const title = $('cam-live-title')
    if (title) {
        title.textContent = camState.type === 0 ? 'Absensi Masuk' : 'Absensi Pulang'
    }
    $('cam-live-retry')?.addEventListener('click', submitCamAttendance)
    camSetScanLabel(false)

    // Keyboard access: Enter/Space triggers the scan button natively; Escape
    // returns to the kiosk so a shared terminal is never a dead end.
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault()
            window.location.assign('/live.html')
        }
    })

    if (await startCam()) {
        clearTimeout(camState.autoSubmitTimer)
        // Give the camera a beat to produce a stable frame before auto-scanning.
        camState.autoSubmitTimer = setTimeout(() => {
            if (camState.busy) return
            if (camFrameReady()) submitCamAttendance()
            else {
                camSetScanLabel(true)
                camSetStatus('Kamera aktif, tetapi gambar belum siap. Tekan tombol Scan Ulang untuk mencoba lagi.', 'warning')
            }
        }, 800)
    }
}

window.initLivePage = initLivePage
window.initCamLivePage = initCamLivePage

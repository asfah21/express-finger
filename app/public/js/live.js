const state = {
    stream: null,
    busy: false,
    resetTimer: null,
    mode: 'kiosk',
    initialized: false
}

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

function setBusy(busy) {
    state.busy = busy
    document.querySelectorAll('[data-live-type]').forEach((button) => {
        button.disabled = busy
    })
    const capture = $('live-capture')
    if (capture) capture.classList.toggle('is-processing', busy)
}

function showResult(employeeName, type) {
    const result = $('live-result')
    const name = $('live-result-name')
    if (!result || !name) return
    name.textContent = employeeName || 'Karyawan'
    result.querySelector('small').textContent = type === 0 ? 'Absensi masuk berhasil' : 'Absensi pulang berhasil'
    result.classList.add('is-visible')
    result.setAttribute('aria-hidden', 'false')
    clearTimeout(state.resetTimer)
    state.resetTimer = setTimeout(() => {
        result.classList.remove('is-visible')
        result.setAttribute('aria-hidden', 'true')
        setStatus('Pilih tombol di bawah untuk memulai.', 'neutral')
    }, 500)
}

async function startCamera() {
    if (state.stream) return true
    if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('Browser tidak mendukung kamera. Gunakan Chrome atau Edge terbaru.', 'error')
        return false
    }
    try {
        state.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'user' },
                width: { ideal: 1280, min: 320 },
                height: { ideal: 720, min: 240 }
            },
            audio: false
        })
        const video = $('live-video')
        if (!video) throw new Error('Live video element is unavailable')
        video.srcObject = state.stream
        video.setAttribute('playsinline', '')
        video.setAttribute('autoplay', '')
        video.muted = true
        await video.play()
        $('live-camera-frame')?.classList.add('is-ready')
        setStatus('Kamera siap. Posisikan wajah di dalam bingkai.', 'ready')
        return true
    } catch (error) {
        console.error('Camera access failed:', error)
        state.stream?.getTracks().forEach((track) => track.stop())
        state.stream = null
        const message = error?.name === 'NotAllowedError'
            ? 'Izin kamera ditolak. Buka pengaturan situs lalu izinkan kamera.'
            : error?.name === 'NotFoundError'
                ? 'Kamera tidak ditemukan pada perangkat ini.'
                : 'Kamera tidak dapat diakses. Pastikan halaman dibuka melalui HTTPS atau localhost.'
        setStatus(message, 'error')
        return false
    }
}

function captureImage() {
    const video = $('live-video')
    const canvas = $('live-canvas')
    if (!video.videoWidth || !video.videoHeight) return null
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d', { alpha: false })
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
}

function hasUsableFrame() {
    const video = $('live-video')
    return Boolean(video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth >= 320 && video.videoHeight >= 240)
}

function scheduleReset() {
    clearTimeout(state.resetTimer)
    state.resetTimer = setTimeout(() => {
        setStatus('Kamera siap. Posisikan wajah di dalam bingkai.', 'ready')
    }, 6500)
}

async function submitAttendance(type) {
    if (state.busy) return
    if (!await startCamera()) return
    if (!hasUsableFrame()) {
        setStatus('Kamera sedang menyiapkan gambar. Tunggu sebentar lalu coba lagi.', 'warning')
        return
    }
    const image = captureImage()
    if (!image) {
        setStatus('Kamera belum siap. Coba lagi.', 'error')
        return
    }
    setBusy(true)
    setStatus(type === 0 ? 'Memproses Masuk…' : 'Memproses Pulang…', 'processing')
    let response
    try {
        response = await fetch('/api/live/attendance', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type, image })
        })
        const data = await response.json().catch(() => ({}))
        if (response.ok) {
            const employee = data.data || {}
            showResult(employee.nama, type)
        } else if (response.status === 409) {
            setStatus('Absensi yang sama baru saja tercatat. Silakan coba lagi setelah 1 menit.', 'warning')
        } else {
            setStatus(data.message || 'Wajah tidak dikenali. Coba posisikan wajah dengan lebih jelas.', 'error')
        }
    } catch (error) {
        console.error('Attendance request failed:', error)
        setStatus('Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.', 'error')
    } finally {
        setBusy(false)
        if (!response?.ok) scheduleReset()
    }
}

export async function initLivePage(mode = 'kiosk') {
    state.mode = mode
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
            camSetStatus('Kamera siap. Tahan posisi hingga wajah terbaca.', 'ready')
            return true
        } catch (error) {
            console.error('Camera access failed:', error)
            camState.stream?.getTracks().forEach((track) => track.stop())
            camState.stream = null
            $('cam-live-camera-frame')?.classList.remove('is-ready')
            camSetStatus(error?.name === 'NotAllowedError'
                ? 'Izin kamera ditolak. Izinkan kamera pada pengaturan situs, lalu tekan Coba lagi.'
                : error?.name === 'NotFoundError'
                    ? 'Kamera tidak ditemukan pada perangkat ini.'
                    : 'Kamera tidak dapat diakses. Pastikan halaman dibuka melalui HTTPS atau localhost.', 'error')
            return false
        } finally {
            camState.startPromise = null
        }
    })()
    return camState.startPromise
}

async function submitCamAttendance() {
    if (camState.busy || !await startCam()) return
    if (!camFrameReady()) return camSetStatus('Kamera sedang menyiapkan gambar. Tunggu sebentar.', 'warning')
    const image = camImage()
    if (!image) return camSetStatus('Gambar kamera belum siap. Coba lagi.', 'error')
    camState.busy = true
    $('cam-live-capture')?.classList.add('is-processing')
    camSetStatus('Memeriksa wajah…', 'processing')
    let response
    try {
        response = await fetch('/api/live/attendance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: camState.type, image }) })
        const data = await response.json().catch(() => ({}))
        if (response.ok) {
            $('cam-live-result-name').textContent = data.data?.nama || 'Karyawan'
            $('cam-live-result-label').textContent = camState.type === 0 ? 'Absensi masuk berhasil' : 'Absensi pulang berhasil'
            $('cam-live-result')?.classList.add('is-visible')
            $('cam-live-result')?.setAttribute('aria-hidden', 'false')
            camSetStatus('Wajah dikenali dan absensi berhasil dicatat.', 'success')
            setTimeout(() => window.location.assign('/live.html'), 2500)
        } else if (response.status === 404) {
            camSetStatus('Wajah tidak dikenali. Pastikan wajah terang, terlihat penuh, dan berada di tengah.', 'error')
        } else if (response.status === 409) {
            camSetStatus('Absensi yang sama baru saja tercatat. Silakan coba lagi setelah 1 menit.', 'warning')
        } else {
            camSetStatus(data.message || 'Verifikasi gagal. Atur posisi wajah lalu ulangi.', 'error')
        }
    } catch (error) {
        console.error('Attendance request failed:', error)
        camSetStatus('Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.', 'error')
    } finally {
        camState.busy = false
        $('cam-live-capture')?.classList.remove('is-processing')
    }
}

export async function initCamLivePage() {
    if (camState.initialized) return
    camState.initialized = true
    camState.type = [0, 1].includes(camState.type) ? camState.type : 0
    const title = $('cam-live-title')
    if (title) {
        title.textContent = camState.type === 0 ? 'Verifikasi untuk Masuk' : 'Verifikasi untuk Pulang'
    }
    $('cam-live-retry')?.addEventListener('click', submitCamAttendance)
    if (await startCam()) {
        clearTimeout(camState.autoSubmitTimer)
        camState.autoSubmitTimer = setTimeout(() => {
            if (camFrameReady()) submitCamAttendance()
            else camSetStatus('Kamera aktif, tetapi gambar belum siap. Tekan Coba lagi.', 'warning')
        }, 350)
    }
}

window.initLivePage = initLivePage
window.initCamLivePage = initCamLivePage

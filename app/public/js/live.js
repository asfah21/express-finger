const state = {
    stream: null,
    busy: false,
    resetTimer: null,
    mode: 'kiosk',
    initialized: false
}

const $ = (id) => document.getElementById(id)

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
            setStatus('Sudah absen untuk jenis kehadiran ini hari ini.', 'warning')
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
        button.addEventListener('click', () => submitAttendance(Number(button.dataset.liveType)))
    })
    setStatus('Pilih Masuk atau Pulang untuk meminta akses kamera.', 'neutral')
}

window.initLivePage = initLivePage

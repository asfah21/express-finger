import { state } from './state.js';
import { refreshOverviewRealtime, applyLiveAttendanceNewOverview } from './pages/overview.js';

let source = null;
let debounceTimer = null;
let trailingRefreshTimer = null;
let consecutiveErrors = 0;
let refreshCooldownUntil = 0;

const DEBOUNCE_MS = 1000;             // Coalesce burst events (was 400)
const MIN_REFRESH_INTERVAL_MS = 5000; // At most 1 network refresh per 5s (peak-hour safety)
const MAX_CONSECUTIVE_ERRORS = 5;     // Stop & retry lambat jika koneksi gagal terus (401/offline)
const RETRY_DELAY_MS = 60000;         // Coba sambung lagi setelah jeda

/**
 * Subscribe ke feed SSE absensi realtime (/api/events/stream).
 *
 * Event minimal (attendance:new / attendance:bulk):
 *   - attendance:new → baris lengkap, dirender langsung (tanpa network).
 *   - attendance:bulk → partial refresh + throttle jaringan (maks 1 per
 *     MIN_REFRESH_INTERVAL_MS, trailing edge) agar burst event saat jam sibuk
 *     tidak memicu reload/recompute beruntun.
 * Hanya halaman overview yang menerima update realtime:
 *   - attendance:new → update recent logs + total hari ini secara lokal.
 *   - attendance:bulk → partial refresh ringan (tanpa devices/employees/chart).
 * Halaman /logs TIDAK lagi di-refresh via SSE — datanya dimuat penuh dengan
 * skeleton saat navigasi/ganti filter, sehingga tidak ada micro refresh.
 * Report berat (overview chart/daily/pair) TIDAK di-refetch per event — ia
 * di-refresh oleh TTL + job precompute di server.
 */
export function startRealtimeFeed() {
    if (source) return;
    if (typeof EventSource === 'undefined') return; // safety untuk browser lama

    source = new EventSource('/api/events/stream');

    source.addEventListener('attendance:new', onAttendanceEvent);
    source.addEventListener('attendance:bulk', onAttendanceEvent);

    source.onopen = () => {
        consecutiveErrors = 0;
        console.info('[realtime] SSE connected');
    };

    source.onerror = () => {
        // EventSource auto-reconnect (retry: 3000). Jika gagal terus menerus
        // (mis. sesi login habis / server down), berhenti dulu agar tidak
        // menghantam server, lalu coba lagi setelah jeda.
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && source) {
            source.close();
            source = null;
            setTimeout(startRealtimeFeed, RETRY_DELAY_MS);
        }
    };
}

// Tandai jika ada event bulk dalam window debounce — bulk tidak membawa baris,
// jadi apa pun event terakhir, kita wajib merekonsiliasi via network (jika
// tidak, baris bulk bisa tertelan oleh update lokal attendance:new).
let pendingBulkInWindow = false;

function onAttendanceEvent(event) {
    if (event.type === 'attendance:bulk') pendingBulkInWindow = true;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const hasBulk = pendingBulkInWindow;
        pendingBulkInWindow = false;

        if (!state.currentUser) return;

        if (state.currentPath === 'overview') {
            const payload = parseEventPayload(event);

            // attendance:new dengan payload lengkap + tanpa bulk di window →
            // update lokal (tanpa network).
            if (!hasBulk && event.type === 'attendance:new' && payload) {
                if (!applyLiveAttendanceNewOverview(payload)) {
                    scheduleThrottledRefresh('overview', () => refreshOverviewRealtime());
                }
                return;
            }

            // Ada bulk (atau event lain) → partial refresh ringan (tanpa
            // devices/employees/chart), tetap di-throttle agar burst tidak
            // memicu reload beruntun.
            scheduleThrottledRefresh('overview', () => refreshOverviewRealtime());
            return;
        }

        // Halaman /logs sengaja TIDAK menerima update realtime (SSE) lagi.
        // Data log hanya dimuat penuh dengan skeleton saat navigasi/filter,
        // sehingga tidak ada lagi micro refresh/silent refresh pada tabel.
        return;
    }, DEBOUNCE_MS);
}

/**
 * Throttle network refreshes to at most one per MIN_REFRESH_INTERVAL_MS with a
 * trailing edge: if events keep arriving during the cooldown, the latest
 * refresh is scheduled to run right when the window ends, so no update is ever
 * dropped. Direct (local) updates like attendance:new bypass this throttle.
 */
function scheduleThrottledRefresh(path, fn) {
    clearTimeout(trailingRefreshTimer);
    const run = () => {
        // Page changed while waiting — drop the stale refresh.
        if (state.currentPath !== path) return;
        refreshCooldownUntil = Date.now() + MIN_REFRESH_INTERVAL_MS;
        fn();
    };
    if (Date.now() >= refreshCooldownUntil) {
        run();
        return;
    }
    trailingRefreshTimer = setTimeout(run, refreshCooldownUntil - Date.now());
}

function parseEventPayload(event) {
    if (!event || !event.data) return null;
    try {
        return JSON.parse(event.data);
    } catch {
        return null;
    }
}

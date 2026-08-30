import { state } from './state.js';
import { refreshOverview } from './pages/overview.js';
import { refreshLogs } from './pages/logs.js';

let source = null;
let debounceTimer = null;
let consecutiveErrors = 0;

const DEBOUNCE_MS = 400;          // Coalesce burst event agar tidak memicu banyak fetch
const MAX_CONSECUTIVE_ERRORS = 5; // Stop & retry lambat jika koneksi gagal terus (401/offline)
const RETRY_DELAY_MS = 60000;     // Coba sambung lagi setelah jeda

/**
 * Subscribe ke feed SSE absensi realtime (/api/events/stream).
 *
 * Event dikirim minimal (attendance:new / attendance:bulk) — klien cukup
 * refetch feed aktif. Report berat (overview chart/daily/pair) TIDAK di-refetch
 * per event: ia di-refresh oleh TTL + job precompute di server (Tahap 1), jadi
 * mekanisme ini ringan dan tidak membebani server.
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

function onAttendanceEvent() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (!state.currentUser) return;
        if (state.currentPath === 'overview') {
            refreshOverview(true); // Feed "recent" di overview — force refresh
        } else if (state.currentPath === 'logs') {
            refreshLogs();
        }
    }, DEBOUNCE_MS);
}

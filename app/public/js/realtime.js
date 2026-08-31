import { state } from './state.js';
import { refreshOverview } from './pages/overview.js';
import { refreshLogs, applyLiveAttendanceNew, shouldSkipLogsRefresh } from './pages/logs.js';

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
 *   - attendance:bulk → silent diff refresh + throttle jaringan (maks 1 per
 *     MIN_REFRESH_INTERVAL_MS, trailing edge) agar burst event saat jam sibuk
 *     tidak memicu reload/recompute beruntun.
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

function onAttendanceEvent(event) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (!state.currentUser) return;

        if (state.currentPath === 'overview') {
            // Silent refresh: skip the chart skeleton; network fetch is throttled.
            scheduleThrottledRefresh('overview', () => refreshOverview(true, { silent: true }));
            return;
        }

        if (state.currentPath !== 'logs') return;

        const payload = parseEventPayload(event);

        if (event.type === 'attendance:new' && payload) {
            // Full row payload → render locally (no network, no throttle needed).
            applyLiveAttendanceNew(payload);
            return;
        }

        // attendance:bulk (and others): skip when the event can't affect the
        // visible logs (source/date filter mismatch), else silent diff refresh
        // throttled so bursts don't cause reload storms (#1/#2/#3).
        if (shouldSkipLogsRefresh(payload?.source)) return;
        scheduleThrottledRefresh('logs', () => refreshLogs({ silent: true }));
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

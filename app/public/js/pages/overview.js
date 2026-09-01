import { state } from '../state.js';
import { getWitaDateString, getUtcTimestampParts } from '../utils.js';

let attendanceChart = null;
let attendanceChartCache = {}; // cache data chart per rentang (7/14/30 hari)
const ATTENDANCE_CHART_CACHE_TTL = 300000; // 5 menit

// Cache sederhana untuk menghindari fetch ulang saat pindah page lalu balik
let overviewCache = {
    timestamp: 0,
    data: null
};
const OVERVIEW_CACHE_TTL = 120000; // 2 menit

export async function refreshOverview(force = false, { silent = false } = {}) {
    const now = Date.now();

    // Refresh Employee Status chart (cache-nya sendiri, dedupe per 60 detik)
    refreshStatusChart();

    // Jika tidak dipaksa refresh dan cache masih valid, skip fetch API
    if (!force && overviewCache.data && (now - overviewCache.timestamp < OVERVIEW_CACHE_TTL)) {
        // Tampilkan data dari cache
        const cached = overviewCache.data;
        if (cached.statDevices !== undefined) {
            const el = document.getElementById('stat-devices');
            if (el) el.innerText = cached.statDevices;
        }
        if (cached.statEmployees !== undefined) {
            const el = document.getElementById('stat-employees');
            if (el) el.innerText = cached.statEmployees;
        }
        if (cached.statLogs !== undefined) {
            const el = document.getElementById('stat-logs');
            if (el) el.innerText = cached.statLogs;
        }
        if (cached.recentLogsHtml) {
            const body = document.getElementById('recent-logs-body');
            if (body) body.innerHTML = cached.recentLogsHtml;
        }
        if (cached.lateCount !== undefined) {
            const el = document.getElementById('late-today-count');
            if (el) el.innerText = cached.lateCount;
        }
        if (cached.lateHtml) {
            const body = document.getElementById('late-today-body');
            if (body) body.innerHTML = cached.lateHtml;
        }
        if (cached.paginationTotal !== undefined) {
            state.pagination.overview.total = cached.paginationTotal;
            window.updatePaginationUI('overview');
        }
        if (cached.lastUpdate) {
            const el = document.getElementById('overview-last-update');
            if (el) el.innerText = cached.lastUpdate;
        }
        // Restore chart dari cache tanpa fetch API
        if (cached.chartData && attendanceChart) {
            attendanceChart.data.labels = cached.chartData.labels;
            attendanceChart.data.datasets[0].data = cached.chartData.checkinData;
            attendanceChart.data.datasets[1].data = cached.chartData.checkoutData;
            attendanceChart.update('none'); // Update tanpa animasi
        }
        return; // Skip fetch API
    }

    try {
        const s = state.pagination.overview;
        const today = getWitaDateString();

        // Show loading states (skipped on silent realtime refresh to avoid blink).
        // Skeleton chart hanya saat chart belum pernah dirender; saat refresh berikut
        // chart lama tetap tampil agar tidak micro-refresh/kedip.
        if (!silent) {
            if (!attendanceChart) showChartLoading(true);
            document.querySelectorAll('.stat-value').forEach(el => el.classList.add('loading'));
        }

        // Fetch all data in parallel - total counts come from limit=1 requests
        const [devicesRes, empRes, overviewRes] = await Promise.all([
            fetch('/api/devices?limit=1'),
            fetch('/api/employees?limit=1'),
            fetch(`/api/stats/overview?days=${document.getElementById('chart-range')?.value || 7}&limit=${s.size}&offset=${s.page * s.size}`)
        ]);

        if (!devicesRes.ok || !empRes.ok || !overviewRes.ok) {
            console.warn('One or more API responses failed, skipping overview update.');
            return;
        }

        const devicesData = await devicesRes.json();
        const employeesData = await empRes.json();
        const overviewData = await overviewRes.json();
        const overview = overviewData.data || {};

        // Update stat values and remove loading class
        const statDevices = document.getElementById('stat-devices');
        const statEmployees = document.getElementById('stat-employees');
        const statLogs = document.getElementById('stat-logs');

        if (statDevices) { statDevices.innerText = devicesData.data?.total || 0; statDevices.classList.remove('loading'); }
        if (statEmployees) { statEmployees.innerText = employeesData.data?.total || 0; statEmployees.classList.remove('loading'); }
        if (statLogs) { statLogs.innerText = overview.recentTotal || 0; statLogs.classList.remove('loading'); }

        s.total = overview.recentTotal || 0;
        renderRecentLogs(overview.recent || []);
        window.updatePaginationUI('overview');

        renderChartData(overview.chart || []);
        prefetchAttendanceRanges();
        refreshLateToday(today);

        const lastUpdateEl = document.getElementById('overview-last-update');
        if (lastUpdateEl) {
            lastUpdateEl.innerText = 'Last Updated: ' + new Date().toLocaleTimeString('id-ID');
        }

        // Simpan snapshot DOM ke cache agar tetap koheren saat update parsial/lokal
        snapshotOverviewCache();
    } catch (err) {
        console.error('Failed to refresh overview', err);
        // Remove loading states even on error
        document.querySelectorAll('.stat-value.loading').forEach(el => el.classList.remove('loading'));
        showChartLoading(false);
    }
}

/**
 * Show or hide the chart skeleton loading overlay
 */
function showChartLoading(isLoading) {
    const skeleton = document.getElementById('chart-skeleton');
    const canvas = document.getElementById('attendance-chart');
    if (skeleton) {
        skeleton.style.display = isLoading ? 'flex' : 'none';
    }
    if (canvas) {
        canvas.style.display = isLoading ? 'none' : 'block';
    }
}

// Redupkan chart-wrapper saat memuat ulang data (indikator loading tanpa kedip).
function setChartDimming(canvasId, dim) {
    const canvas = document.getElementById(canvasId);
    const wrapper = canvas && canvas.closest('.chart-wrapper');
    if (wrapper) wrapper.style.opacity = dim ? '0.55' : '1';
}

// Prefetch range chart lain di background agar perpindahan filter terasa instan.
let attendancePrefetchDone = false;
function prefetchAttendanceRanges() {
    if (attendancePrefetchDone) return;
    attendancePrefetchDone = true;
    setTimeout(() => {
        const rangeSelect = document.getElementById('chart-range');
        const current = rangeSelect ? parseInt(rangeSelect.value) : 7;
        [7, 14, 30].forEach(days => {
            if (days === current || attendanceChartCache[days]) return;
            fetch(`/api/stats/overview?days=${days}`)
                .then(res => (res.ok ? res.json() : null))
                .then(payload => {
                    const chart = payload?.data?.chart || [];
                    if (chart.length) {
                        attendanceChartCache[days] = { timestamp: Date.now(), chart };
                    }
                })
                .catch(() => { /* abaikan gagal prefetch */ });
        });
    }, 1500);
}

/**
 * Fetch attendance data and render the chart
 * Supports dynamic range (7, 14, 30 days) and mobile responsive layout
 * OPTIMIZED: Uses 1 API call per day instead of 2 (type=0 + type=1)
 */
async function refreshChart() {
    const rangeSelect = document.getElementById('chart-range');
    const daysCount = rangeSelect ? parseInt(rangeSelect.value) : 7;

    // Cache hit → render instan tanpa network (perpindahan filter cepat).
    const cached = attendanceChartCache[daysCount];
    if (cached && (Date.now() - cached.timestamp < ATTENDANCE_CHART_CACHE_TTL)) {
        renderChartData(cached.chart);
        return;
    }

    // Skeleton hanya di render pertama; saat ganti filter chart lama tetap tampil
    // (hanya diredupkan) agar tidak micro-refresh/kedip.
    if (!attendanceChart) {
        showChartLoading(true);
    } else {
        setChartDimming('attendance-chart', true);
    }

    try {
        const response = await fetch(`/api/stats/overview?days=${daysCount}`);
        if (!response.ok) throw new Error(`Overview chart request failed (${response.status})`);
        const payload = await response.json();
        const chart = payload.data?.chart || [];
        attendanceChartCache[daysCount] = { timestamp: Date.now(), chart };
        renderChartData(chart);
    } catch (err) {
        console.error('Failed to refresh chart:', err);
        if (!attendanceChart) showChartLoading(false);
        setChartDimming('attendance-chart', false);
    }
}

function renderChartData(chartRows) {
    const labels = [];
    const checkinData = [];
    const checkoutData = [];
    const isMobile = window.innerWidth < 640;
    const daysCount = chartRows.length;

    // For mobile with 30 days, use weekly aggregation to avoid clutter
    const useWeekly = isMobile && daysCount > 14;

    if (useWeekly) {
        for (let i = 0; i < chartRows.length; i += 7) {
            const week = chartRows.slice(i, i + 7);
            labels.push(`W${Math.floor(i / 7) + 1}`);
            checkinData.push(week.reduce((sum, row) => sum + row.checkIn, 0));
            checkoutData.push(week.reduce((sum, row) => sum + row.checkOut, 0));
        }
    } else {
        for (const row of chartRows) {
            const label = isMobile
                ? row.date.slice(8, 10) + '/' + row.date.slice(5, 7)
                : new Date(`${row.date}T12:00:00+08:00`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
            labels.push(label);
            checkinData.push(row.checkIn);
            checkoutData.push(row.checkOut);
        }
    }

    const canvas = document.getElementById('attendance-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    const isLight = document.documentElement.classList.contains('theme-light');
    const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
    const textColor = isLight ? '#64748b' : '#94a3b8';

    // Adjust bar percentage for mobile
    const barPct = isMobile ? 0.6 : 0.4;

    // Hide skeleton before rendering (idempotent) & kembalikan kecerahan card
    showChartLoading(false);
    setChartDimming('attendance-chart', false);

    if (attendanceChart) {
        // Update in place — hindari destroy/recreate yang menyebabkan kedip.
        attendanceChart.data.labels = labels;
        attendanceChart.data.datasets[0].data = checkinData;
        attendanceChart.data.datasets[1].data = checkoutData;
        attendanceChart.options.plugins.legend.labels.color = textColor;
        attendanceChart.options.plugins.legend.labels.font.size = isMobile ? 10 : 12;
        attendanceChart.options.scales.x.grid.color = gridColor;
        attendanceChart.options.scales.x.ticks.color = textColor;
        attendanceChart.options.scales.x.ticks.maxRotation = isMobile ? 45 : 0;
        attendanceChart.options.scales.x.ticks.font.size = isMobile ? 9 : 11;
        attendanceChart.options.scales.y.grid.color = gridColor;
        attendanceChart.options.scales.y.ticks.color = textColor;
        attendanceChart.options.scales.y.ticks.font.size = isMobile ? 9 : 11;
        attendanceChart.update();
    } else {
        attendanceChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Check In',
                        data: checkinData,
                        backgroundColor: 'rgba(36, 97, 150, 0.7)',
                        borderColor: '#246196',
                        borderWidth: 1,
                        borderRadius: 4,
                        barPercentage: barPct
                    },
                    {
                        label: 'Check Out',
                        data: checkoutData,
                        backgroundColor: 'rgba(119, 160, 68, 0.7)',
                        borderColor: '#77a044',
                        borderWidth: 1,
                        borderRadius: 4,
                        barPercentage: barPct
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: textColor,
                            font: { size: isMobile ? 10 : 12 }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            maxRotation: isMobile ? 45 : 0,
                            font: { size: isMobile ? 9 : 11 }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            stepSize: 1,
                            font: { size: isMobile ? 9 : 11 }
                        }
                    }
                }
            }
        });
        // Prefetch range lain di background (sekali per sesi).
        prefetchAttendanceRanges();
    }

    // Simpan ke cache per rentang (key = jumlah hari) agar perpindahan filter instan.
    if (daysCount > 0) {
        attendanceChartCache[daysCount] = { timestamp: Date.now(), chart: chartRows };
    }
}

// Expose refreshChart to window for the range selector onChange
window.refreshChart = refreshChart;

// ---------------------------------------------------------------------------
// Employee Status Chart — rincian status karyawan per hari (Terlambat,
// Sedang Bekerja, Tidak Absen Masuk, Tidak Absen Pulang, Tidak Hadir).
// Mengikuti gaya chart Attendance Overview dengan filter Today / 7 / 30 days.
// Sumber data: /api/pair (baris summary per karyawan per hari) + /api/logs/late.
// ---------------------------------------------------------------------------

let statusChart = null;
let statusChartRequestId = 0; // guard agar respons lama tidak menimpa yang baru

// Cache per rentang (1/7/30) agar berpindah filter terasa instan dan auto-refresh
// tidak mem-fetch ulang terlalu sering. Data historis (7/30 hari) jarang berubah →
// TTL lebih panjang agar tidak membebani DB; range "Today" tetap segar (60 detik).
let statusChartCache = {}; // key: rentang (days) → { timestamp, labels, data }

function showStatusChartLoading(isLoading) {
    const skeleton = document.getElementById('status-chart-skeleton');
    const canvas = document.getElementById('status-chart');
    if (skeleton) skeleton.style.display = isLoading ? 'flex' : 'none';
    if (canvas) canvas.style.display = isLoading ? 'none' : 'block';
}

// Generate `days` tanggal WITA berurutan (tertua → terbaru) berakhir hari ini.
function buildDateRange(days, today) {
    const dates = [];
    const base = new Date(`${today}T00:00:00Z`);
    for (let i = days - 1; i >= 0; i--) {
        const dt = new Date(base);
        dt.setUTCDate(dt.getUTCDate() - i);
        dates.push(dt.toISOString().slice(0, 10));
    }
    return dates;
}

async function refreshStatusChart(force = false) {
    const rangeSelect = document.getElementById('status-chart-range');
    const days = rangeSelect ? parseInt(rangeSelect.value) || 1 : 1;

    // TTL cache sesuai rentang: Today 60s, 7 hari 120s, 30 hari 300s.
    const ttl = days <= 1 ? 60000 : days <= 7 ? 120000 : 300000;

    // Cache hit → render instan tanpa network.
    const cached = statusChartCache[days];
    if (!force && cached && (Date.now() - cached.timestamp < ttl)) {
        renderStatusChartData(cached.labels, cached.data);
        return;
    }

    // Skeleton hanya di render pertama; saat ganti filter chart lama tetap tampil
    // (hanya diredupkan) agar tidak micro-refresh/kedip.
    if (!statusChart) {
        showStatusChartLoading(true);
    } else {
        setChartDimming('status-chart', true);
    }

    const requestId = ++statusChartRequestId;

    try {
        const today = getWitaDateString();
        const dates = buildDateRange(days, today);
        const start = dates[0];
        const end = dates[dates.length - 1];

        // Fetch pair + late secara paralel agar filter terasa lebih cepat.
        const [pairRes, lateRes] = await Promise.all([
            fetch(`/api/pair?from_date=${start}&to_date=${end}&limit=50000`),
            fetch(`/api/logs/late?from=${encodeURIComponent(`${start}T00:00:00+08:00`)}&to=${encodeURIComponent(`${end}T23:59:59+08:00`)}&limit=50000`)
        ]);
        if (!pairRes.ok) throw new Error(`Pair request failed (${pairRes.status})`);
        if (!lateRes.ok) throw new Error(`Late request failed (${lateRes.status})`);

        const [pairData, lateData] = await Promise.all([pairRes.json(), lateRes.json()]);
        const summary = pairData.data?.summary || [];
        if (pairData.data?.has_more) {
            console.warn('Employee status chart: pair summary truncated by limit, counts may be incomplete.');
        }
        const lateList = lateData.data?.list || lateData.data?.logs || [];

        // Bucket status per hari.
        const byDay = {};
        for (const d of dates) {
            byDay[d] = { hadirPenuh: 0, bekerja: 0, tdkPulang: 0, tdkMasuk: 0, tidakHadir: 0, late: 0 };
        }

        for (const row of summary) {
            const day = byDay[row.date];
            if (!day) continue;
            switch (row.status) {
                case 'Hadir Penuh': day.hadirPenuh++; break;
                case 'Sedang Bekerja': day.bekerja++; break;
                case 'Tidak Absen Pulang': day.tdkPulang++; break;
                case 'Tidak Absen Masuk': day.tdkMasuk++; break;
                default: day.tidakHadir++; break;
            }
        }

        for (const log of lateList) {
            const p = getUtcTimestampParts(log.timestamp);
            const d = `${p.year}-${p.month}-${p.day}`;
            if (byDay[d]) byDay[d].late++;
        }

        const chartData = {};
        for (const d of dates) {
            const day = byDay[d];
            chartData[d] = {
                late: day.late,
                bekerja: day.bekerja,
                tdkMasuk: day.tdkMasuk,
                tdkPulang: day.tdkPulang,
                tidakHadir: day.tidakHadir
            };
        }

        // Respons basi (pengguna sudah ganti range) → jangan timpa render terbaru.
        if (requestId !== statusChartRequestId) return;

        statusChartCache[days] = { timestamp: Date.now(), labels: dates, data: chartData };
        renderStatusChartData(dates, chartData);
    } catch (err) {
        console.error('Failed to refresh status chart:', err);
        if (!statusChart) showStatusChartLoading(false);
        setChartDimming('status-chart', false);
    }
}

function renderStatusChartData(dates, chartData) {
    const canvas = document.getElementById('status-chart');
    if (!canvas) return;

    const isMobile = window.innerWidth < 640;
    const useWeekly = isMobile && dates.length > 14;

    const labels = [];
    const late = [], bekerja = [], tdkMasuk = [], tdkPulang = [], tidakHadir = [];
    const pushWeek = (week, arr, key) => arr.push(week.reduce((sum, d) => sum + (chartData[d]?.[key] || 0), 0));

    if (useWeekly) {
        for (let i = 0; i < dates.length; i += 7) {
            const week = dates.slice(i, i + 7);
            labels.push(`W${Math.floor(i / 7) + 1}`);
            pushWeek(week, late, 'late');
            pushWeek(week, bekerja, 'bekerja');
            pushWeek(week, tdkMasuk, 'tdkMasuk');
            pushWeek(week, tdkPulang, 'tdkPulang');
            pushWeek(week, tidakHadir, 'tidakHadir');
        }
    } else {
        for (const d of dates) {
            if (dates.length === 1) {
                labels.push('Today');
            } else {
                labels.push(isMobile
                    ? d.slice(8, 10) + '/' + d.slice(5, 7)
                    : new Date(`${d}T12:00:00+08:00`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }));
            }
            const c = chartData[d] || {};
            late.push(c.late || 0);
            bekerja.push(c.bekerja || 0);
            tdkMasuk.push(c.tdkMasuk || 0);
            tdkPulang.push(c.tdkPulang || 0);
            tidakHadir.push(c.tidakHadir || 0);
        }
    }

    const ctx = canvas.getContext('2d');

    const isLight = document.documentElement.classList.contains('theme-light');
    const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
    const textColor = isLight ? '#64748b' : '#94a3b8';

    // Sembunyikan skeleton sebelum render (idempotent) & kembalikan kecerahan card
    showStatusChartLoading(false);
    setChartDimming('status-chart', false);

    if (statusChart) {
        // Update in place — hindari destroy/recreate yang bikin kedip.
        statusChart.data.labels = labels;
        const ds = statusChart.data.datasets;
        ds[0].data = late;
        ds[1].data = bekerja;
        ds[2].data = tdkMasuk;
        ds[3].data = tdkPulang;
        ds[4].data = tidakHadir;
        statusChart.options.plugins.legend.labels.color = textColor;
        statusChart.options.plugins.legend.labels.font.size = isMobile ? 9 : 11;
        statusChart.options.scales.x.grid.color = gridColor;
        statusChart.options.scales.x.ticks.color = textColor;
        statusChart.options.scales.x.ticks.maxRotation = isMobile ? 45 : 0;
        statusChart.options.scales.x.ticks.font.size = isMobile ? 9 : 11;
        statusChart.options.scales.y.grid.color = gridColor;
        statusChart.options.scales.y.ticks.color = textColor;
        statusChart.options.scales.y.ticks.font.size = isMobile ? 9 : 11;
        statusChart.update();
        return;
    }

    statusChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Terlambat', data: late, backgroundColor: 'rgba(245, 158, 11, 0.7)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 3, barPercentage: 0.9, categoryPercentage: 0.85 },
                { label: 'Sedang Bekerja', data: bekerja, backgroundColor: 'rgba(59, 130, 246, 0.7)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 3, barPercentage: 0.9, categoryPercentage: 0.85 },
                { label: 'Tidak Absen Masuk', data: tdkMasuk, backgroundColor: 'rgba(168, 85, 247, 0.7)', borderColor: '#a855f7', borderWidth: 1, borderRadius: 3, barPercentage: 0.9, categoryPercentage: 0.85 },
                { label: 'Tidak Absen Pulang', data: tdkPulang, backgroundColor: 'rgba(14, 165, 233, 0.7)', borderColor: '#0ea5e9', borderWidth: 1, borderRadius: 3, barPercentage: 0.9, categoryPercentage: 0.85 },
                { label: 'Tidak Hadir', data: tidakHadir, backgroundColor: 'rgba(239, 68, 68, 0.7)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 3, barPercentage: 0.9, categoryPercentage: 0.85 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: textColor,
                        boxWidth: 12,
                        boxHeight: 12,
                        font: { size: isMobile ? 9 : 11 }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        maxRotation: isMobile ? 45 : 0,
                        font: { size: isMobile ? 9 : 11 }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        stepSize: 1,
                        font: { size: isMobile ? 9 : 11 }
                    }
                }
            }
        }
    });
}

// Expose refreshStatusChart to window for the range selector onChange
window.refreshStatusChart = refreshStatusChart;

function renderRecentLogRowHtml(log) {
    // Align with the Attendance Log page: the stored timestamp already
    // carries the WITA wall-clock as a UTC value, so read UTC parts
    // instead of applying a second Asia/Makassar (+8h) conversion.
    const witaParts = getUtcTimestampParts(log.timestamp);
    const timeStr = `${witaParts.hour}:${witaParts.minute}`;
    const secondsStr = witaParts.second;

    return `
        <tr>
            <td>
                <i class="fas fa-history text-warning mr-2" style="font-size: 0.8rem;"></i>
                <strong class="text-warning text-lg">${timeStr}</strong>
                <small class="opacity-50 text-xs">:${secondsStr}</small>
            </td>
            <td>
                <div class="emp-info">${log.nama || log.user_id}</div>
                <div class="emp-sub">ID: ${log.user_id}</div>
            </td>
            <td><span class="badge ${log.type == 0 ? 'badge-success' : 'badge-warning'}">${log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang')}</span></td>
            <td>
                <div class="device-info">
                    <i class="fas fa-wifi"></i>
                    ${log.device_name || log.device_sn || '-'}
                </div>
            </td>
        </tr>
    `;
}

function renderRecentLogs(logs) {
    const body = document.getElementById('recent-logs-body');
    body.innerHTML = logs.map(renderRecentLogRowHtml).join('') || '<tr><td colspan="4" class="empty-state"><i class="fas fa-info-circle"></i><div class="empty-title">No Activity Today</div><div class="empty-subtitle">No attendance records found for today. Pull data from devices to see logs.</div></td></tr>';
}

// ---------------------------------------------------------------------------
// Realtime partial refresh — ringan & tanpa blink (#1/#2/#3).
// Hanya memperbarui data yang bergerak cepat (recent logs, total hari ini,
// late today). Devices/employees/chart adalah domain refresh penuh / TTL.
// ---------------------------------------------------------------------------

function buildRecentLogRow(log) {
    const tr = document.createElement('tr');
    tr.dataset.id = String(log.id ?? '');
    tr.innerHTML = renderRecentLogRowHtml(log);
    return tr;
}

// Apakah timestamp (WITA wall-clock tersimpan sebagai UTC) jatuh di hari ini (WITA)?
function timestampIsToday(ts) {
    if (!ts) return true; // tidak bisa dipastikan → anggap hari ini
    const dt = new Date(ts);
    if (Number.isNaN(dt.getTime())) return true;
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}` === getWitaDateString();
}

/**
 * Terapkan event `attendance:new` (payload baris lengkap) ke kartu overview
 * secara lokal — TANPA network request.
 * @returns {boolean} true jika tertangani (dirender / sengaja dilewati),
 *                    false jika perlu fallback ke partial refresh jaringan.
 */
export function applyLiveAttendanceNewOverview(payload) {
    if (!payload || payload.id == null) return false;

    // Overview hanya menampilkan aktivitas hari ini (WITA).
    if (!timestampIsToday(payload.timestamp)) return true; // bukan untuk kartu ini

    const body = document.getElementById('recent-logs-body');
    if (!body) return false;

    // Baris ini sudah tampil — tidak perlu apa-apa.
    for (const tr of body.querySelectorAll('tr[data-id]')) {
        if (tr.dataset.id === String(payload.id)) return true;
    }

    const s = state.pagination.overview;
    s.total += 1;

    // Row terbaru hanya valid di page pertama (offset 0); di page lain cukup
    // naikkan total, row akan muncul saat kembali ke page 0 / refresh penuh.
    if (s.page === 0) {
        // Buang baris empty-state jika ada agar tidak menumpuk.
        const emptyState = body.querySelector('td.empty-state');
        if (emptyState) body.innerHTML = '';

        const row = buildRecentLogRow(payload);
        const first = body.querySelector('tr[data-id]');
        if (first) body.insertBefore(row, first);
        else body.appendChild(row);

        const rows = body.querySelectorAll('tr[data-id]');
        if (rows.length > s.size) rows[rows.length - 1].remove();
    }

    const statLogs = document.getElementById('stat-logs');
    if (statLogs) {
        const cur = Number(statLogs.innerText || 0);
        statLogs.innerText = String(Number.isFinite(cur) ? cur + 1 : 1);
    }
    window.updatePaginationUI('overview');

    const lastUpdateEl = document.getElementById('overview-last-update');
    if (lastUpdateEl) lastUpdateEl.innerText = 'Last Updated: ' + new Date().toLocaleTimeString('id-ID');

    snapshotOverviewCache();
    return true;
}

/**
 * Partial refresh untuk event `attendance:bulk` (tanpa baris). Satu request
 * ringan ke /api/logs untuk merekonsiliasi recent logs + total hari ini,
 * plus late-today (dengan cache TTL). TIDAK mem-fetch devices/employees dan
 * TIDAK men-render chart.
 */
export async function refreshOverviewRealtime() {
    const s = state.pagination.overview;
    const today = getWitaDateString();
    try {
        const res = await fetch(`/api/logs?from=${encodeURIComponent(`${today}T00:00:00+08:00`)}&limit=${s.size}&offset=${s.page * s.size}`);
        if (!res.ok) return;
        const data = await res.json();
        const logs = data.data?.list || data.data?.logs || [];
        const total = data.data?.total || 0;

        s.total = total;
        renderRecentLogs(logs);
        window.updatePaginationUI('overview');

        const statLogs = document.getElementById('stat-logs');
        if (statLogs) statLogs.innerText = String(total);

        // Await agar kartu late today selesai dirender sebelum snapshot cache
        // (kalau tidak, snapshot bisa menangkap nilai late yang basi).
        await refreshLateToday(today);

        const lastUpdateEl = document.getElementById('overview-last-update');
        if (lastUpdateEl) lastUpdateEl.innerText = 'Last Updated: ' + new Date().toLocaleTimeString('id-ID');

        snapshotOverviewCache();
    } catch (err) {
        console.error('Failed realtime partial overview refresh', err);
    }
}

// Snapshot DOM saat ini ke overviewCache agar cache tetap koheren terhadap
// update parsial/lokal (tidak menimpa data realtime segar dengan data basi).
function snapshotOverviewCache() {
    const statDevices = document.getElementById('stat-devices');
    const statEmployees = document.getElementById('stat-employees');
    const statLogs = document.getElementById('stat-logs');
    const recentLogsBody = document.getElementById('recent-logs-body');
    const lateTodayBody = document.getElementById('late-today-body');
    const lateTodayCount = document.getElementById('late-today-count');
    const lastUpdateEl = document.getElementById('overview-last-update');

    overviewCache = {
        timestamp: Date.now(),
        data: {
            statDevices: statDevices?.innerText || '0',
            statEmployees: statEmployees?.innerText || '0',
            statLogs: statLogs?.innerText || '0',
            recentLogsHtml: recentLogsBody?.innerHTML || '',
            lateCount: lateTodayCount?.innerText || '0',
            lateHtml: lateTodayBody?.innerHTML || '',
            paginationTotal: state.pagination.overview.total,
            lastUpdate: lastUpdateEl?.innerText || '',
            chartData: attendanceChart ? {
                labels: attendanceChart.data.labels,
                checkinData: attendanceChart.data.datasets[0].data,
                checkoutData: attendanceChart.data.datasets[1].data
            } : null
        }
    };
}

function renderLateToday(count, html) {
    const countEl = document.getElementById('late-today-count');
    if (countEl) countEl.innerText = count;
    const body = document.getElementById('late-today-body');
    if (body) body.innerHTML = html;
}

// Cache client untuk kartu Late Today — kartu ini tidak perlu fresh per detik;
// cukup direkonsiliasi berkala (TTL) agar request berat tidak terulang di tiap
// throttle window.
let lateTodayCache = { timestamp: 0, count: 0, html: '' };
const LATE_TODAY_CACHE_TTL = 30000; // 30 detik

async function refreshLateToday(today) {
    // Cache hit → render dari cache tanpa network.
    if (lateTodayCache.html && (Date.now() - lateTodayCache.timestamp < LATE_TODAY_CACHE_TTL)) {
        renderLateToday(lateTodayCache.count, lateTodayCache.html);
        return;
    }

    try {
        const res = await fetch(`/api/logs?from=${today}T00:00:00&type=0&limit=5000`);
        const data = await res.json();
        const logs = data.data?.list || data.data?.logs || [];

        const staffLate = logs.filter(log =>
            (log.emp_type === 'S75' || log.emp_type === 'S77') &&
            log.ket && log.ket.toLowerCase().includes('terlambat')
        );

        const seen = new Map();
        for (const log of staffLate) {
            if (!seen.has(log.user_id)) {
                seen.set(log.user_id, log);
            }
        }
        const unique = Array.from(seen.values()).slice(0, 10);

        const html = unique.map((log, idx) => {
            // Same convention as the Recent Activity card / Attendance Log page:
            // the stored timestamp is WITA wall-clock as UTC, so read UTC parts.
            const timeParts = getUtcTimestampParts(log.timestamp);
            return `
                <tr>
                    <td class="text-muted">${idx + 1}</td>
                    <td>
                        <div class="emp-info">${log.nama || 'Unknown'}</div>
                        <div class="emp-sub">NIK: ${log.nik || '-'}</div>
                    </td>
                    <td>${log.department || '-'}</td>
                    <td>${log.jabatan || '-'}</td>
                    <td><strong class="text-error text-lg">${timeParts.hour}:${timeParts.minute}</strong></td>
                    <td><span class="text-error font-medium">${log.ket}</span></td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="6" class="empty-state"><i class="fas fa-check-circle text-success mr-2"></i>No late staff today — great job!</td></tr>';

        lateTodayCache = { timestamp: Date.now(), count: seen.size, html };
        renderLateToday(seen.size, html);
    } catch (err) {
        console.error('Failed to fetch late today', err);
        const body = document.getElementById('late-today-body');
        if (body) body.innerHTML = '<tr><td colspan="6" class="empty-state">Failed to load data</td></tr>';
    }
}

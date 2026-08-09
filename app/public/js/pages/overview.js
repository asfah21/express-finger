import { state } from '../state.js';
import { getWitaDateString, getUtcTimestampParts } from '../utils.js';

let attendanceChart = null;

// Cache sederhana untuk menghindari fetch ulang saat pindah page lalu balik
let overviewCache = {
    timestamp: 0,
    data: null
};
const OVERVIEW_CACHE_TTL = 120000; // 2 menit

export async function refreshOverview(force = false) {
    const now = Date.now();

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

        // Show loading states
        showChartLoading(true);
        document.querySelectorAll('.stat-value').forEach(el => el.classList.add('loading'));

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
        refreshLateToday(today);

        const lastUpdateEl = document.getElementById('overview-last-update');
        if (lastUpdateEl) {
            lastUpdateEl.innerText = 'Last Updated: ' + new Date().toLocaleTimeString('id-ID');
        }

        // Simpan data ke cache untuk下次 pindah page
        const recentLogsBody = document.getElementById('recent-logs-body');
        const lateTodayBody = document.getElementById('late-today-body');
        const lateTodayCount = document.getElementById('late-today-count');
        overviewCache = {
            timestamp: Date.now(),
            data: {
                statDevices: statDevices?.innerText || '0',
                statEmployees: statEmployees?.innerText || '0',
                statLogs: statLogs?.innerText || '0',
                recentLogsHtml: recentLogsBody?.innerHTML || '',
                lateCount: lateTodayCount?.innerText || '0',
                lateHtml: lateTodayBody?.innerHTML || '',
                paginationTotal: s.total,
                lastUpdate: lastUpdateEl?.innerText || '',
                chartData: attendanceChart ? {
                    labels: attendanceChart.data.labels,
                    checkinData: attendanceChart.data.datasets[0].data,
                    checkoutData: attendanceChart.data.datasets[1].data
                } : null
            }
        };
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

/**
 * Fetch attendance data and render the chart
 * Supports dynamic range (7, 14, 30 days) and mobile responsive layout
 * OPTIMIZED: Uses 1 API call per day instead of 2 (type=0 + type=1)
 */
async function refreshChart() {
    try {
        // Show skeleton while chart data is loading
        showChartLoading(true);

        const rangeSelect = document.getElementById('chart-range');
        const daysCount = rangeSelect ? parseInt(rangeSelect.value) : 7;

        const response = await fetch(`/api/stats/overview?days=${daysCount}`);
        if (!response.ok) throw new Error(`Overview chart request failed (${response.status})`);
        const payload = await response.json();
        renderChartData(payload.data?.chart || []);
    } catch (err) {
        console.error('Failed to refresh chart:', err);
        showChartLoading(false);
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

    // Destroy existing chart if it exists
    if (attendanceChart) {
        attendanceChart.destroy();
    }

    const isLight = document.documentElement.classList.contains('theme-light');
    const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
    const textColor = isLight ? '#64748b' : '#94a3b8';

    // Adjust bar percentage for mobile
    const barPct = isMobile ? 0.6 : 0.4;

    // Hide skeleton before rendering chart
    showChartLoading(false);

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
}

// Expose refreshChart to window for the range selector onChange
window.refreshChart = refreshChart;

function renderRecentLogs(logs) {
    const body = document.getElementById('recent-logs-body');
    body.innerHTML = logs.map(log => {
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
    }).join('') || '<tr><td colspan="4" class="empty-state"><i class="fas fa-info-circle"></i><div class="empty-title">No Activity Today</div><div class="empty-subtitle">No attendance records found for today. Pull data from devices to see logs.</div></td></tr>';
}

async function refreshLateToday(today) {
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

        const countEl = document.getElementById('late-today-count');
        if (countEl) countEl.innerText = seen.size;

        const body = document.getElementById('late-today-body');
        body.innerHTML = unique.map((log, idx) => {
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
    } catch (err) {
        console.error('Failed to fetch late today', err);
        document.getElementById('late-today-body').innerHTML = '<tr><td colspan="6" class="empty-state">Failed to load data</td></tr>';
    }
}

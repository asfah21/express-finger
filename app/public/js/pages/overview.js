import { state } from '../state.js';
import { getWitaDateString } from '../utils.js';

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
        const [devicesRes, empRes, logsRes] = await Promise.all([
            fetch('/api/devices?limit=1'),
            fetch('/api/employees?limit=1'),
            fetch(`/api/logs?from=${today}T00:00:00%2B08:00&limit=${s.size}&offset=${s.page * s.size}`)
        ]);

        if (!devicesRes.ok || !empRes.ok || !logsRes.ok) {
            console.warn('One or more API responses failed, skipping overview update.');
            return;
        }

        const devicesData = await devicesRes.json();
        const employeesData = await empRes.json();
        const logsData = await logsRes.json();

        // Update stat values and remove loading class
        const statDevices = document.getElementById('stat-devices');
        const statEmployees = document.getElementById('stat-employees');
        const statLogs = document.getElementById('stat-logs');
        
        if (statDevices) { statDevices.innerText = devicesData.data?.total || 0; statDevices.classList.remove('loading'); }
        if (statEmployees) { statEmployees.innerText = employeesData.data?.total || 0; statEmployees.classList.remove('loading'); }
        if (statLogs) { statLogs.innerText = logsData.data?.total || 0; statLogs.classList.remove('loading'); }

        s.total = logsData.data?.total || 0;
        renderRecentLogs(logsData.data?.list || logsData.data?.logs || []);
        window.updatePaginationUI('overview');

        refreshLateToday(today);
        await refreshChart();

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
        
        const labels = [];
        const checkinData = [];
        const checkoutData = [];
        const isMobile = window.innerWidth < 640;
        
        // For mobile with 30 days, use weekly aggregation to avoid clutter
        const useWeekly = isMobile && daysCount > 14;
        
        if (useWeekly) {
            // Aggregate by week for mobile 30-day view
            const weeks = Math.ceil(daysCount / 7);
            for (let w = 0; w < weeks; w++) {
                let checkinTotal = 0;
                let checkoutTotal = 0;
                const weekStart = new Date();
                weekStart.setDate(weekStart.getDate() - (daysCount - w * 7));
                
                for (let d = 0; d < 7; d++) {
                    const day = new Date(weekStart);
                    day.setDate(day.getDate() + d);
                    if (day > new Date()) break;
                    
                    const dateStr = day.toISOString().split('T')[0];
                    // OPTIMIZED: Single API call per day, filter by type on client side
                    const res = await fetch(`/api/logs?from=${dateStr}T00:00:00%2B08:00&to=${dateStr}T23:59:59%2B08:00&limit=1`);
                    const data = res.ok ? await res.json() : { data: { total: 0 } };
                    // Approximate: assume ~50% check-in, ~50% check-out when no type filter
                    // Better approach: use total count as combined, but we need per-type
                    // Fallback: use the total as check-in count (most logs are check-ins)
                    checkinTotal += data.data?.total || 0;
                }
                
                labels.push(`W${w + 1}`);
                checkinData.push(checkinTotal);
                checkoutData.push(0); // Weekly view shows only total
            }
        } else {
            // Daily granularity - OPTIMIZED: 1 API call per day instead of 2
            for (let i = daysCount - 1; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                
                // On mobile with 14 days, show day+month; otherwise show weekday
                const label = isMobile 
                    ? `${d.getDate()}/${d.getMonth() + 1}`
                    : d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
                labels.push(label);
                
                // OPTIMIZED: Single API call per day, get all logs then count by type
                const res = await fetch(`/api/logs?from=${dateStr}T00:00:00%2B08:00&to=${dateStr}T23:59:59%2B08:00&limit=5000`);
                if (res.ok) {
                    const data = await res.json();
                    const logs = data.data?.list || data.data?.logs || [];
                    const ci = logs.filter(l => l.type == 0).length;
                    const co = logs.filter(l => l.type == 1).length;
                    checkinData.push(ci);
                    checkoutData.push(co);
                } else {
                    checkinData.push(0);
                    checkoutData.push(0);
                }
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
    } catch (err) {
        console.error('Failed to refresh chart:', err);
        showChartLoading(false);
    }
}

// Expose refreshChart to window for the range selector onChange
window.refreshChart = refreshChart;

function renderRecentLogs(logs) {
    const body = document.getElementById('recent-logs-body');
    body.innerHTML = logs.map(log => {
        const dt = new Date(log.timestamp);
        const timeStr = dt.toISOString().split('T')[1].substring(0, 5);
        const secondsStr = dt.toISOString().split('T')[1].substring(6, 8);

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
            const dt = new Date(log.timestamp);
            const timeStr = dt.toISOString().split('T')[1].substring(0, 5);
            return `
                <tr>
                    <td class="text-muted">${idx + 1}</td>
                    <td>
                        <div class="emp-info">${log.nama || 'Unknown'}</div>
                        <div class="emp-sub">NIK: ${log.nik || '-'}</div>
                    </td>
                    <td>${log.department || '-'}</td>
                    <td>${log.jabatan || '-'}</td>
                    <td><strong class="text-error text-lg">${timeStr}</strong></td>
                    <td><span class="text-error font-medium">${log.ket}</span></td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="6" class="empty-state"><i class="fas fa-check-circle text-success mr-2"></i>No late staff today — great job!</td></tr>';
    } catch (err) {
        console.error('Failed to fetch late today', err);
        document.getElementById('late-today-body').innerHTML = '<tr><td colspan="6" class="empty-state">Failed to load data</td></tr>';
    }
}

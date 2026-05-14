import { state } from '../state.js';
import { getWitaDateString } from '../utils.js';

export async function refreshOverview() {
    try {
        const s = state.pagination.overview;
        const today = getWitaDateString();
        const [devicesRes, empRes, logsRes] = await Promise.all([
            fetch('/api/devices?limit=1'),
            fetch('/api/employees?limit=1'),
            fetch(`/api/logs?from=${today}T00:00:00&limit=${s.size}&offset=${s.page * s.size}`)
        ]);

        if (!devicesRes.ok || !empRes.ok || !logsRes.ok) {
            console.warn('One or more API responses failed, skipping overview update.');
            return;
        }

        const devicesData = await devicesRes.json();
        const employeesData = await empRes.json();
        const logsData = await logsRes.json();

        document.getElementById('stat-devices').innerText = devicesData.data?.total || 0;
        document.getElementById('stat-employees').innerText = employeesData.data?.total || 0;

        // Logs stats (today)
        document.getElementById('stat-logs').innerText = '...';
        fetch(`/api/logs?from=${today}T00:00:00%2B08:00`).then(r => {
            if (!r.ok) return null;
            return r.json();
        }).then(d => {
            if (d) document.getElementById('stat-logs').innerText = d.data?.total || 0;
        }).catch(() => { });

        s.total = logsData.data?.total || 0;
        renderRecentLogs(logsData.data?.logs || []);
        // updatePaginationUI is global for now, will be called from main
        window.updatePaginationUI('overview');

        refreshLateToday(today);

        const lastUpdateEl = document.getElementById('overview-last-update');
        if (lastUpdateEl) {
            lastUpdateEl.innerText = 'Last Updated: ' + new Date().toLocaleTimeString('id-ID');
        }
    } catch (err) {
        console.error('Failed to refresh overview', err);
    }
}

function renderRecentLogs(logs) {
    const body = document.getElementById('recent-logs-body');
    body.innerHTML = logs.map(log => {
        const dt = new Date(log.timestamp);
        const timeStr = dt.toISOString().split('T')[1].substring(0, 5);
        const secondsStr = dt.toISOString().split('T')[1].substring(6, 8);

        return `
            <tr>
                <td>
                    <i class="fas fa-history" style="color: var(--warning); margin-right: 0.5rem; font-size: 0.8rem;"></i>
                    <strong style="color: var(--warning); font-size: 1.05rem;">${timeStr}</strong>
                    <small style="opacity: 0.5; font-size: 0.7rem;">:${secondsStr}</small>
                </td>
                <td>
                    <div style="font-weight: 600;">${log.nama || log.user_id}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">ID: ${log.user_id}</div>
                </td>
                <td><span class="badge ${log.type == 0 ? 'badge-success' : 'badge-warning'}">${log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang')}</span></td>
                <td>
                    <div style="font-size: 0.85rem; font-weight: 500; display: flex; align-items: center; gap: 0.4rem;">
                        <i class="fas fa-wifi" style="font-size: 0.75rem; color: var(--primary); opacity: 0.7;"></i>
                        ${log.device_name || log.device_sn || '-'}
                    </div>
                </td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;"><i class="fas fa-info-circle" style="margin-right:0.5rem"></i>No activity recorded today.</td></tr>';
}

async function refreshLateToday(today) {
    try {
        const res = await fetch(`/api/logs?from=${today}T00:00:00&type=0&limit=5000`);
        const data = await res.json();
        const logs = data.data?.logs || [];

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
                    <td style="color: var(--text-muted);">${idx + 1}</td>
                    <td>
                        <div style="font-weight: 600;">${log.nama || 'Unknown'}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">NIK: ${log.nik || '-'}</div>
                    </td>
                    <td>${log.department || '-'}</td>
                    <td>${log.jabatan || '-'}</td>
                    <td><strong style="color: var(--error); font-size: 1.05rem;">${timeStr}</strong></td>
                    <td><span style="color: var(--error); font-weight: 500;">${log.ket}</span></td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;"><i class="fas fa-check-circle" style="color: var(--success); margin-right: 0.5rem;"></i>No late staff today — great job!</td></tr>';
    } catch (err) {
        console.error('Failed to fetch late today', err);
        document.getElementById('late-today-body').innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Failed to load data</td></tr>';
    }
}

import { state } from '../state.js';
import { showToast } from '../utils.js';
import { showSkeleton } from '../skeleton.js';

export async function refreshLate() {
    const s = state.pagination.late;
    const fromDate = document.getElementById('late-date-from').value;
    const toDate = document.getElementById('late-date-to').value;
    const search = document.getElementById('late-search').value;

    // Show skeleton loading
    showSkeleton('late-body', s.size);

    let url = `/api/logs/late?limit=${s.size}&offset=${s.page * s.size}`;
    if (fromDate) url += `&from=${fromDate}T00:00:00%2B08:00`;
    if (toDate) url += `&to=${toDate}T23:59:59%2B08:00`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const res = await fetch(url);
    const data = await res.json();

    s.total = data.data?.total || 0;
    const body = document.getElementById('late-body');

    const logs = data.data?.list || data.data?.logs || [];
    
    if (logs.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="empty-state">
            <i class="fas fa-clock"></i>
            <div class="empty-title">No Late Employees Found</div>
            <div class="empty-subtitle">No employees were late based on the current filters.</div>
        </td></tr>`;
    } else {
        body.innerHTML = logs.map(log => {
            const dt = new Date(log.timestamp);
            const dateStr = `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}/${dt.getUTCFullYear()}`;
            const timeStr = dt.toISOString().split('T')[1].substring(0, 5); 
            const secondsStr = dt.toISOString().split('T')[1].substring(6, 8); 

            return `
                <tr>
                    <td>${log.nik || '-'}</td>
                    <td>
                        <div style="font-weight: 600;">${log.nama || 'Unknown'}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">ID: ${log.user_id}</div>
                    </td>
                    <td style="font-size: 0.8125rem;">
                        <div>${log.department || '-'}</div>
                        <div style="opacity: 0.7;">${log.jabatan || '-'}</div>
                    </td>
                    <td><span class="badge ${log.type == 0 ? 'badge-success' : 'badge-warning'}">${log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang')}</span></td>
                    <td>${dateStr}</td>
                    <td>
                        <strong style="color: var(--error); font-size: 1.1rem;">${timeStr}</strong>
                        <small style="opacity: 0.5; font-size: 0.75rem;">:${secondsStr}</small>
                    </td>
                    <td>
                        <div style="font-size: 0.8125rem; font-weight: 500; color: var(--error)">${log.ket || '-'}</div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.updatePaginationUI('late');
}

let lateSearchTimer;
export function handleLateSearch(val) {
    clearTimeout(lateSearchTimer);
    lateSearchTimer = setTimeout(() => {
        if (val.length >= 3 || val.length === 0) {
            state.pagination.late.page = 0;
            refreshLate();
        }
    }, 600);
}

import { state } from '../state.js';
import { showToast, showConfirm } from '../utils.js';

export async function refreshActivityLogs() {
    const s = state.pagination.activity;
    const search = document.getElementById('activity-search')?.value || '';
    const category = document.getElementById('activity-category')?.value || '';
    const from = document.getElementById('activity-date-from')?.value || '';
    const to = document.getElementById('activity-date-to')?.value || '';

    let url = `/api/activity-logs?limit=${s.size}&offset=${s.page * s.size}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    if (from) url += `&from=${from}T00:00:00%2B08:00`;
    if (to) url += `&to=${to}T23:59:59%2B08:00`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            document.getElementById('activity-body').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--error)">Failed to load activity logs</td></tr>';
            return;
        }
        const data = await res.json();

        s.total = data.data?.total || 0;
        const body = document.getElementById('activity-body');

        const categoryColors = {
            auth: '#60a5fa',
            employee: '#34d399',
            device: '#a78bfa',
            settings: '#fbbf24',
            export: '#f59e0b',
            import: '#10b981',
            sync: '#6366f1',
            general: '#9ca3af'
        };

        const actionIcons = {
            login: 'fa-sign-in-alt',
            logout: 'fa-sign-out-alt',
            add_employee: 'fa-user-plus',
            edit_employee: 'fa-user-edit',
            delete_employee: 'fa-user-minus',
            import_employees: 'fa-file-import',
            add_device: 'fa-plus-circle',
            edit_device: 'fa-edit',
            delete_device: 'fa-trash',
            sync_device: 'fa-sync',
            sync_all: 'fa-sync-alt',
            update_settings: 'fa-cog',
            update_account: 'fa-user-cog',
            export_attendance: 'fa-file-excel',
            export_employees: 'fa-file-excel',
        };

        body.innerHTML = (data.data?.logs || []).map(log => {
            const dt = new Date(log.created_at);
            const dateStr = dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const catColor = categoryColors[log.category] || '#9ca3af';
            const icon = actionIcons[log.action] || 'fa-circle';
            const isSuccess = log.status === 'success';

            return `
                <tr>
                    <td>
                        <div style="font-weight:500;font-size:0.85rem;">${dateStr}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);">${timeStr}</div>
                    </td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.5rem;">
                            <div style="width:30px;height:30px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;flex-shrink:0;">${(log.username || '?')[0].toUpperCase()}</div>
                            <strong>${log.username || '-'}</strong>
                        </div>
                    </td>
                    <td>
                        <span class="badge" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}44;">
                            ${log.category || '-'}
                        </span>
                    </td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.4rem;">
                            <i class="fas ${icon}" style="font-size:0.8rem;color:${catColor};"></i>
                            <span style="font-size:0.85rem;">${log.action || '-'}</span>
                        </div>
                    </td>
                    <td style="max-width:280px;">
                        <div style="font-size:0.82rem;color:var(--text-muted);white-space:normal;line-height:1.4;">${log.detail || '-'}</div>
                    </td>
                    <td style="font-size:0.8rem;color:var(--text-muted);">${log.ip_address || '-'}</td>
                    <td>
                        <span class="badge ${isSuccess ? 'badge-success' : 'badge-error'}">
                            <i class="fas ${isSuccess ? 'fa-check' : 'fa-times'}"></i> ${isSuccess ? 'Success' : 'Error'}
                        </span>
                    </td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;"><i class="fas fa-shield-alt" style="margin-right:0.5rem;"></i>No activity logs found.</td></tr>';

        window.updatePaginationUI('activity');
    } catch (err) {
        console.error('Failed to load activity logs', err);
    }
}

let activitySearchTimer;
export function handleActivitySearch(val) {
    clearTimeout(activitySearchTimer);
    activitySearchTimer = setTimeout(() => {
        if (val.length >= 2 || val.length === 0) {
            state.pagination.activity.page = 0;
            refreshActivityLogs();
        }
    }, 600);
}

export function applyActivityFilter() {
    state.pagination.activity.page = 0;
    refreshActivityLogs();
}

export async function clearOldActivityLogs() {
    showConfirm({
        title: 'Clear Old Activity Logs',
        message: 'This will delete all activity logs older than 90 days. This action cannot be undone.',
        icon: 'fa-trash-alt',
        confirmText: 'Clear Old Logs',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            const res = await fetch('/api/activity-logs/old?days=90', { method: 'DELETE' });
            if (res.ok) {
                const data = await res.json();
                showToast(data.message, 'success');
                refreshActivityLogs();
            } else {
                showToast('Failed to clear logs', 'error');
            }
        }
    });
}

export async function recordClientActivity(action, category, detail) {
    try {
        await fetch('/api/activity-logs/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, category, detail })
        });
    } catch (_) { }
}

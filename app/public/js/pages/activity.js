import { state } from '../state.js';
import { showToast, showConfirm, toggleModal } from '../utils.js';
import { showSkeleton } from '../skeleton.js';

export async function refreshActivityLogs() {
    const s = state.pagination.activity;
    const search = document.getElementById('activity-search')?.value || '';
    const category = document.getElementById('activity-category')?.value || '';
    const from = document.getElementById('activity-date-from')?.value || '';
    const to = document.getElementById('activity-date-to')?.value || '';

    // Show skeleton loading
    showSkeleton('activity-body', s.size);

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

        const logs = data.data?.list || data.data?.logs || [];
        
        if (logs.length === 0) {
            body.innerHTML = `<tr><td colspan="7" class="empty-state">
                <i class="fas fa-shield-alt"></i>
                <div class="empty-title">No Activity Logs Found</div>
                <div class="empty-subtitle">System activities will appear here once users start interacting with the system.</div>
            </td></tr>`;
        } else {
            body.innerHTML = logs.map(log => {
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
            }).join('');
        }

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
    // Tampilkan modal dengan input days
    document.getElementById('modal-title').innerHTML = '<i class="fas fa-trash-alt" style="margin-right:0.5rem;color:var(--error);"></i> Clear Old Activity Logs';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 1.5rem;">
            <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--error); margin-bottom: 1rem;"></i>
            <p style="color: var(--text-muted); margin-bottom: 1rem;">
                This will permanently delete all activity logs older than the specified number of days.
            </p>
            <div class="form-group" style="text-align:left;">
                <label>Delete logs older than (days)</label>
                <input type="number" id="clear-logs-days" value="90" min="1" max="365">
            </div>
        </div>
    `;
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = 'Clear Old Logs';
    saveBtn.style.display = 'block';
    saveBtn.style.background = 'var(--error)';
    saveBtn.onclick = async () => {
        const days = parseInt(document.getElementById('clear-logs-days').value) || 90;
        if (days < 1) return showToast('Minimum 1 day', 'warning');
        
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        
        try {
            const res = await fetch(`/api/activity-logs/old?days=${days}`, { method: 'DELETE' });
            if (res.ok) {
                const data = await res.json();
                showToast(data.message, 'success');
                toggleModal(false);
                refreshActivityLogs();
            } else {
                showToast('Failed to clear logs', 'error');
            }
        } catch (err) {
            showToast('Network error', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = 'Clear Old Logs';
        }
    };
    toggleModal(true);
}

export async function exportActivityLogs() {
    const search = document.getElementById('activity-search')?.value || '';
    const category = document.getElementById('activity-category')?.value || '';
    const from = document.getElementById('activity-date-from')?.value || '';
    const to = document.getElementById('activity-date-to')?.value || '';

    showToast('Preparing export data...');

    try {
        let url = `/api/activity-logs?limit=${state.EXPORT_LIMIT}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (category) url += `&category=${encodeURIComponent(category)}`;
        if (from) url += `&from=${from}T00:00:00%2B08:00`;
        if (to) url += `&to=${to}T23:59:59%2B08:00`;

        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch activity logs');
        const data = await res.json();
        const logs = data.data?.list || data.data?.logs || [];

        if (logs.length === 0) {
            return showToast('No data to export', 'warning');
        }

        const exportData = logs.map(log => {
            const dt = new Date(log.created_at);
            const dateStr = dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return {
                Date: dateStr,
                Time: timeStr,
                Username: log.username || '-',
                Category: log.category || '-',
                Action: log.action || '-',
                Detail: log.detail || '-',
                'IP Address': log.ip_address || '-',
                Status: log.status || '-'
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Activity Logs");

        const today = new Date().toISOString().split('T')[0];
        XLSX.writeFile(workbook, `activity_logs_${today}.xlsx`);
        showToast('Export successful', 'success');

        if (window.recordClientActivity) {
            await window.recordClientActivity('export_activity_logs', 'export', `Exported activity logs (count: ${logs.length})`);
        }
    } catch (err) {
        console.error('Export failed:', err);
        showToast('Export failed', 'error');
    }
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

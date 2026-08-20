import { state } from '../state.js';
import { showToast, toggleModal, getWitaDateString, getUtcTimestampParts } from '../utils.js';
import { showSkeleton } from '../skeleton.js';


// Default the From/To date filters to today (WITA) on every page open,
// but never overwrite a date range the user has already selected.
function setDefaultLateDates() {
    const fromEl = document.getElementById('late-date-from');
    const toEl = document.getElementById('late-date-to');
    const today = getWitaDateString();
    if (fromEl && !fromEl.value) fromEl.value = today;
    if (toEl && !toEl.value) toEl.value = today;
}

export async function refreshLate() {
    setDefaultLateDates();
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
            // Align with the Attendance Log page: the stored timestamp is WITA
            // wall-clock as UTC, so read UTC parts to avoid a second +8h shift.
            const witaParts = getUtcTimestampParts(log.timestamp);
            const dateStr = `${witaParts.day}/${witaParts.month}/${witaParts.year}`;
            const timeStr = `${witaParts.hour}:${witaParts.minute}`;
            const secondsStr = witaParts.second;

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

export function showLateExportMenu() {
    toggleModal(true);
    document.getElementById('modal-title').innerText = 'Export Late Attendance Data';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 2rem;">
            <i class="fas fa-file-excel" style="font-size: 3.5rem; color: var(--secondary); margin-bottom: 1rem;"></i>
            <p style="color: var(--text-muted);">Select the time range for your Excel export.</p>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            <button class="btn-primary" id="btn-late-export-filtered" style="background: var(--primary);">
                <i class="fas fa-globe"></i> Export Data (Based on Current Filters)
            </button>
            <button class="btn-primary" id="btn-late-export-today" style="background: #4a5568;">
                <i class="fas fa-calendar-day"></i> Export Today Only
            </button>
            <button class="btn-primary" id="btn-late-export-3days" style="background: #2d3748;">
                <i class="fas fa-calendar-week"></i> Export Last 3 Days
            </button>
            <button class="btn-primary" id="btn-late-export-absolute" style="background: #1a202c;">
                <i class="fas fa-file-invoice"></i> Export All (Ignored Filters)
            </button>
        </div>
    `;

    document.getElementById('btn-late-export-filtered').onclick = () => performLateExport('all');
    document.getElementById('btn-late-export-today').onclick = () => performLateExport('today');
    document.getElementById('btn-late-export-3days').onclick = () => performLateExport('3days');
    document.getElementById('btn-late-export-absolute').onclick = () => performLateExport('all_absolute');

    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.style.display = 'none';
}

async function performLateExport(range) {
    try {
        let fromDate = '';
        let toDate = '';
        let search = document.getElementById('late-search').value;
        const today = getWitaDateString();

        if (range === 'today') {
            fromDate = today;
            toDate = today;
        } else if (range === '3days') {
            const now = new Date();
            const last3 = new Date();
            last3.setDate(last3.getDate() - 3);
            fromDate = last3.toISOString();
            toDate = now.toISOString();
            search = '';
        } else if (range === 'all_absolute') {
            fromDate = '';
            toDate = '';
            search = '';
        } else {
            fromDate = document.getElementById('late-date-from').value;
            toDate = document.getElementById('late-date-to').value;
        }

        toggleModal(false);
        showToast('Preparing export data...');

        let url = `/api/logs/late?limit=${state.EXPORT_LIMIT}`;
        if (range === '3days') {
            url += `&from=${fromDate}&to=${toDate}`;
        } else {
            if (fromDate) url += `&from=${fromDate}T00:00:00%2B08:00`;
            if (toDate) url += `&to=${toDate}T23:59:59%2B08:00`;
        }
        if (search) url += `&search=${encodeURIComponent(search)}`;

        const res = await fetch(url);
        const data = await res.json();
        const logs = data.data?.list || data.data?.logs || [];

        const exportData = logs.map(log => {
            // Same convention as the table: read UTC parts directly.
            const timeParts = getUtcTimestampParts(log.timestamp);
            const timeFull = `${timeParts.hour}:${timeParts.minute}:${timeParts.second}`;
            return {
                NIK: log.nik,
                Name: log.nama,
                'User ID': log.user_id,
                Department: log.department,
                Divisi: log.divisi,
                Jabatan: log.jabatan,
                Status: log.absensi,
                Date: `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}/${dt.getUTCFullYear()}`,
                Time: timeFull,
                Device: log.device_name,
                Remarks: log.ket
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Late Attendance");

        XLSX.writeFile(workbook, `late_attendance_${range}_${today}.xlsx`);
        showToast('Export successful', 'success');

        if (window.recordClientActivity) {
            await window.recordClientActivity('export_late_attendance', 'export', `Exported late attendance logs (range: ${range}, count: ${logs.length})`);
        }
    } catch (err) {
        showToast('Export failed', 'error');
    }
}



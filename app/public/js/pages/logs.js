import { state } from '../state.js';
import { showToast, toggleModal, getWitaDateString } from '../utils.js';

export async function refreshLogs() {
    const s = state.pagination.logs;
    const fromDate = document.getElementById('log-date-from').value;
    const toDate = document.getElementById('log-date-to').value;
    const search = document.getElementById('log-search').value;

    let url = `/api/logs?limit=${s.size}&offset=${s.page * s.size}`;
    if (fromDate) url += `&from=${fromDate}T00:00:00%2B08:00`;
    if (toDate) url += `&to=${toDate}T23:59:59%2B08:00`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const res = await fetch(url);
    const data = await res.json();

    s.total = data.data?.total || 0;
    const body = document.getElementById('logs-body');

    body.innerHTML = (data.data?.logs || []).map(log => {
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
                    <strong style="color: var(--primary); font-size: 1.1rem;">${timeStr}</strong>
                    <small style="opacity: 0.5; font-size: 0.75rem;">:${secondsStr}</small>
                </td>
                <td>
                    <div style="font-size: 0.8125rem; font-weight: 500; color: ${log.ket?.includes('Terlambat') ? 'var(--error)' : 'inherit'}">${log.ket || '-'}</div>
                </td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="7" style="text-align: center;">No logs found</td></tr>';

    window.updatePaginationUI('logs');
}

let logSearchTimer;
export function handleLogSearch(val) {
    clearTimeout(logSearchTimer);
    logSearchTimer = setTimeout(() => {
        if (val.length >= 3 || val.length === 0) {
            state.pagination.logs.page = 0;
            refreshLogs();
        }
    }, 600);
}

export function showExportMenu() {
    toggleModal(true);
    document.getElementById('modal-title').innerText = 'Export Attendance Logs';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 2rem;">
            <i class="fas fa-file-excel" style="font-size: 3.5rem; color: var(--secondary); margin-bottom: 1rem;"></i>
            <p style="color: var(--text-muted);">Select the time range for your Excel export.</p>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            <button class="btn-primary" id="btn-export-filtered" style="background: var(--primary);">
                <i class="fas fa-globe"></i> Export Data (Based on Current Filters)
            </button>
            <button class="btn-primary" id="btn-export-today" style="background: #4a5568;">
                <i class="fas fa-calendar-day"></i> Export Today Only
            </button>
            <button class="btn-primary" id="btn-export-3days" style="background: #2d3748;">
                <i class="fas fa-calendar-week"></i> Export Last 3 Days
            </button>
            <button class="btn-primary" id="btn-export-absolute" style="background: #1a202c;">
                <i class="fas fa-file-invoice"></i> Export All (Ignored Filters)
            </button>
        </div>
    `;

    document.getElementById('btn-export-filtered').onclick = () => performExport('all');
    document.getElementById('btn-export-today').onclick = () => performExport('today');
    document.getElementById('btn-export-3days').onclick = () => performExport('3days');
    document.getElementById('btn-export-absolute').onclick = () => performExport('all_absolute');

    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.style.display = 'none';
}

async function performExport(range) {
    try {
        let fromDate = '';
        let toDate = '';
        let search = document.getElementById('log-search').value;
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
            fromDate = document.getElementById('log-date-from').value;
            toDate = document.getElementById('log-date-to').value;
        }

        toggleModal(false);
        showToast('Preparing export data...');

        let url = `/api/logs?limit=50000`;
        if (range === '3days') {
            url += `&from=${fromDate}&to=${toDate}`;
        } else {
            if (fromDate) url += `&from=${fromDate}T00:00:00%2B08:00`;
            if (toDate) url += `&to=${toDate}T23:59:59%2B08:00`;
        }
        if (search) url += `&search=${encodeURIComponent(search)}`;

        const res = await fetch(url);
        const data = await res.json();
        const logs = data.data?.logs || [];

        const exportData = logs.map(log => {
            const dt = new Date(log.timestamp);
            const timeFull = dt.toISOString().split('T')[1].substring(0, 8); 
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
        XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance Logs");

        XLSX.writeFile(workbook, `attendance_${range}_${today}.xlsx`);
        showToast('Export successful', 'success');
        
        if (window.recordClientActivity) {
            await window.recordClientActivity('export_attendance', 'export', `Exported attendance logs (range: ${range}, count: ${logs.length})`);
        }
    } catch (err) {
        showToast('Export failed', 'error');
    }
}

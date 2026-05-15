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
            <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 0.5rem 0;">
            <button class="btn-primary" id="btn-print-slip" style="background: var(--secondary); color: white;">
                <i class="fas fa-file-pdf"></i> Generate Monthly Slip (PDF)
            </button>
        </div>
    `;

    document.getElementById('btn-export-filtered').onclick = () => performExport('all');
    document.getElementById('btn-export-today').onclick = () => performExport('today');
    document.getElementById('btn-export-3days').onclick = () => performExport('3days');
    document.getElementById('btn-export-absolute').onclick = () => performExport('all_absolute');
    document.getElementById('btn-print-slip').onclick = showPrintSlipModal;

    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.style.display = 'none';
}

export async function showPrintSlipModal() {
    // Fetch all employees to select one
    const res = await fetch('/api/employees?limit=1000');
    const data = await res.json();
    const employees = data.data?.list || [];

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    document.getElementById('modal-title').innerText = 'Generate Monthly Slip';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 1.5rem;">
            <i class="fas fa-print" style="font-size: 3rem; color: var(--primary); margin-bottom: 1rem;"></i>
            <p style="color: var(--text-muted);">Generate a professional monthly attendance report.</p>
        </div>
        <div class="form-group">
            <label>Select Employee</label>
            <select id="slip-employee-id" style="width: 100%; padding: 0.75rem; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 8px;">
                <option value="">-- Select Employee --</option>
                ${employees.map(e => `<option value="${e.user_id}">${e.nama} (${e.nik || e.user_id})</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>Select Month</label>
            <input type="month" id="slip-month" value="${currentMonth}" style="width: 100%;">
        </div>
    `;

    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.style.display = 'block';
    saveBtn.innerText = 'Generate PDF Slip';
    saveBtn.onclick = generatePDFSlip;
}

async function generatePDFSlip() {
    const employeeId = document.getElementById('slip-employee-id').value;
    const monthStr = document.getElementById('slip-month').value;

    if (!employeeId || !monthStr) {
        return showToast('Please select employee and month', 'warning');
    }

    try {
        showToast('Fetching data for PDF...');
        const [year, month] = monthStr.split('-');
        
        // Fetch specific employee logs for that month
        const fromDate = `${monthStr}-01T00:00:00%2B08:00`;
        const lastDay = new Date(year, month, 0).getDate();
        const toDate = `${monthStr}-${lastDay}T23:59:59%2B08:00`;

        const res = await fetch(`/api/logs?user_id=${employeeId}&from=${fromDate}&to=${toDate}&limit=1000`);
        const data = await res.json();
        const logs = data.data?.logs || [];

        if (logs.length === 0) {
            return showToast('No data found for this period', 'warning');
        }

        const employee = logs[0]; // Info employee dari log pertama
        
        // Generate PDF using jsPDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // --- Header ---
        doc.setFontSize(22);
        doc.setTextColor(40, 44, 52);
        doc.text("MONTHLY ATTENDANCE SLIP", 105, 20, null, null, "center");
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Generated on: ${new Date().toLocaleString()}`, 105, 26, null, null, "center");

        doc.setDrawColor(0, 102, 204);
        doc.setLineWidth(0.5);
        doc.line(14, 30, 196, 30);

        // --- Info Section ---
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.setFont(undefined, 'bold');
        doc.text("EMPLOYEE INFORMATION", 14, 40);
        
        doc.setFont(undefined, 'normal');
        doc.setFontSize(10);
        doc.text(`Name: ${employee.nama || 'N/A'}`, 14, 48);
        doc.text(`NIK: ${employee.nik || '-'}`, 14, 54);
        doc.text(`Dept: ${employee.department || '-'}`, 14, 60);
        
        doc.text(`Period: ${new Date(year, month-1).toLocaleString('id-ID', { month: 'long', year: 'numeric' })}`, 130, 48);
        doc.text(`ID Device: ${employee.user_id}`, 130, 54);
        doc.text(`Jabatan: ${employee.jabatan || '-'}`, 130, 60);

        // --- Table ---
        const tableData = logs.map(log => {
            const dt = new Date(log.timestamp);
            return [
                `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}/${dt.getUTCFullYear()}`,
                dt.toISOString().split('T')[1].substring(0, 8),
                log.absensi,
                log.ket || '-'
            ];
        });

        doc.autoTable({
            startY: 70,
            head: [['Date', 'Time', 'Status', 'Remarks']],
            body: tableData,
            theme: 'striped',
            headStyles: { fillColor: [0, 102, 204], textColor: 255 },
            alternateRowStyles: { fillColor: [245, 245, 245] },
            margin: { top: 70 },
        });

        // --- Footer / Signature ---
        const finalY = doc.lastAutoTable.finalY + 20;
        doc.setFontSize(10);
        doc.text("Printed by AZRA System", 14, 285);
        
        doc.text("Manager / Supervisor,", 150, finalY);
        doc.text("( ____________________ )", 150, finalY + 25);

        doc.save(`Slip_${employee.nama}_${monthStr}.pdf`);
        showToast('PDF Generated successfully', 'success');
        toggleModal(false);

    } catch (err) {
        console.error(err);
        showToast('Failed to generate PDF', 'error');
    }
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

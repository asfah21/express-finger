import { state } from '../state.js';
import { showToast, toggleModal, getWitaDateString } from '../utils.js';
import { showSkeleton } from '../skeleton.js';

// Pair pagination state (managed locally since it's not in the global state)
const pairPagination = {
    page: 0,
    size: 25,
    total: 0
};

export async function refreshPair() {
    const fromDate = document.getElementById('pair-date-from').value;
    const toDate = document.getElementById('pair-date-to').value;
    const search = document.getElementById('pair-search').value;
    const status = document.getElementById('pair-status')?.value || 'all';
    const department = document.getElementById('pair-department')?.value || 'all';

    // Show skeleton loading on every refresh, including filter/page changes
    showSkeleton('pair-body', pairPagination.size);

    const body = document.getElementById('pair-body');

    let url = `/api/pair?limit=${pairPagination.size}&offset=${pairPagination.page * pairPagination.size}`;
    if (fromDate) url += `&from_date=${fromDate}`;
    if (toDate) url += `&to_date=${toDate}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (status && status !== 'all') url += `&status=${status}`;
    if (department && department !== 'all') url += `&department=${encodeURIComponent(department)}`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        const summary = data.data?.summary || data.data?.list || data.data || [];
        pairPagination.total = data.data?.total || 0;

        updatePairSummaryChips(data.data?.summary_counts);

        body.innerHTML = summary.map(item => {
            const status = item.status || (item.check_in && item.check_out ? 'Hadir Penuh' : (item.check_in ? 'Tidak Absen Pulang' : (item.check_out ? 'Tidak Absen Masuk' : 'Tidak Hadir')));
            let statusBadge = 'badge-warning';
            if (status === 'Hadir Penuh') statusBadge = 'badge-success';
            else if (status === 'Sedang Bekerja') statusBadge = 'badge-info';
            else if (status === 'Tidak Absen Masuk' || status === 'Tidak Hadir') statusBadge = 'badge-error';

            // Format date as D/M/YYYY like attendance logs
            let dateFormatted = item.date || '-';
            if (item.date && item.date.includes('-')) {
                const parts = item.date.split('-');
                dateFormatted = `${parseInt(parts[2])}/${parseInt(parts[1])}/${parts[0]}`;
            }

            return `
                <tr>
                    <td>${item.nik || '-'}</td>
                    <td>
                        <div class="emp-info">${item.nama || 'Unknown'}</div>
                        <div class="emp-sub">ID: ${item.user_id}</div>
                    </td>
                    <td class="text-sm">
                        <div>${item.department || '-'}</div>
                        <div class="opacity-70">${item.jabatan || '-'}</div>
                    </td>
                    <td class="nowrap">${dateFormatted}</td>
                    <td>
                        ${item.check_in
                            ? `<strong class="text-primary text-lg">${item.check_in}</strong>`
                            : '<span class="text-muted">-</span>'
                        }
                    </td>
                    <td>
                        ${item.check_out
                            ? `<strong class="text-primary text-lg">${item.check_out}</strong>`
                            : '<span class="text-muted">-</span>'
                        }
                    </td>
                    <td>
                        ${item.work_hours
                            ? `<span class="font-semibold">${item.work_hours}</span>`
                            : '<span class="text-muted">-</span>'
                        }
                    </td>
                    <td><span class="badge ${statusBadge}">${status}</span></td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="8" class="empty-state">No data found</td></tr>';

        updatePairPaginationUI();
    } catch (err) {
        console.error('Failed to fetch pair data:', err);
        document.getElementById('pair-body').innerHTML = '<tr><td colspan="8" class="empty-state text-error">Failed to load data</td></tr>';
    }
}

function updatePairPaginationUI() {
    const info = document.getElementById('pair-info');
    const start = pairPagination.page * pairPagination.size + 1;
    const end = Math.min((pairPagination.page + 1) * pairPagination.size, pairPagination.total);
    if (info) info.innerText = `Showing ${pairPagination.total ? start : 0}-${end} of ${pairPagination.total} items`;

    const prevBtn = document.getElementById('pair-prev-btn');
    const nextBtn = document.getElementById('pair-next-btn');
    if (prevBtn) prevBtn.disabled = pairPagination.page <= 0;
    if (nextBtn) nextBtn.disabled = pairPagination.page >= Math.ceil(pairPagination.total / pairPagination.size) - 1;

    const nums = document.getElementById('pair-pagination-numbers');
    if (nums) {
        nums.innerHTML = '';
        const totalPages = Math.ceil(pairPagination.total / pairPagination.size);
        if (totalPages <= 1) return;

        const maxLinks = window.innerWidth < 640 ? 3 : 5;
        let startPage = Math.max(0, pairPagination.page - Math.floor(maxLinks / 2));
        let endPage = Math.min(totalPages - 1, startPage + maxLinks - 1);

        if (endPage - startPage < maxLinks - 1) {
            startPage = Math.max(0, endPage - maxLinks + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            const btn = document.createElement('div');
            btn.className = `page-link ${i === pairPagination.page ? 'active' : ''}`;
            btn.innerText = i + 1;
            btn.onclick = () => { pairPagination.page = i; refreshPair(); };
            nums.appendChild(btn);
        }
    }
}

// Expose pagination functions to window
window.nextPairPage = function() {
    const totalPages = Math.ceil(pairPagination.total / pairPagination.size);
    if (pairPagination.page < totalPages - 1) {
        pairPagination.page++;
        refreshPair();
    }
};

window.prevPairPage = function() {
    if (pairPagination.page > 0) {
        pairPagination.page--;
        refreshPair();
    }
};

window.updatePairPageSize = function(val) {
    pairPagination.size = parseInt(val);
    pairPagination.page = 0;
    refreshPair();
};

window.handlePairDateChange = function() {
    const fromDate = document.getElementById('pair-date-from').value;
    const toDate = document.getElementById('pair-date-to').value;
    if (fromDate && toDate && fromDate > toDate) {
        showToast('Tanggal "From" tidak boleh lebih besar dari "To"', 'warning');
        return;
    }
    pairPagination.page = 0;
    refreshPair();
};

window.handlePairStatusChange = function() {
    pairPagination.page = 0;
    refreshPair();
};

window.handlePairDepartmentChange = function() {
    pairPagination.page = 0;
    refreshPair();
};

function updatePairSummaryChips(counts) {
    const el = document.getElementById('pair-summary-chips');
    if (!el) return;
    counts = counts || {};
    const set = (id, val) => {
        const node = document.getElementById(id);
        if (node) node.textContent = Number(val) || 0;
    };
    set('pair-count-hadir', counts.hadir_penuh);
    set('pair-count-bekerja', counts.sedang_bekerja);
    set('pair-count-pulang', counts.tidak_absen_pulang);
    set('pair-count-masuk', counts.tidak_absen_masuk);
    set('pair-count-tidak', counts.tidak_hadir);
}

let pairDepartmentsLoaded = false;
export async function populatePairDepartments() {
    if (pairDepartmentsLoaded) return;
    const select = document.getElementById('pair-department');
    if (!select) return;
    try {
        // Use the lightweight dedicated endpoint instead of pulling up to 1000
        // full employee records (SELECT * FROM employee) just to extract names.
        const res = await fetch('/api/employees/departments');
        const data = await res.json();
        const departments = Array.isArray(data?.data) ? data.data : [];
        select.innerHTML = '<option value="all">All Departments</option>' + departments.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
        pairDepartmentsLoaded = true;
    } catch (err) {
        console.error('Failed to load departments:', err);
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&' + 'amp;',
        '<': '&' + 'lt;',
        '>': '&' + 'gt;',
        '"': '&' + 'quot;',
        "'": '&' + '#39;'
    }[c]));
}

let pairSearchTimer;
window.handlePairSearch = function(val) {
    clearTimeout(pairSearchTimer);
    pairSearchTimer = setTimeout(() => {
        if (val.length >= 3 || val.length === 0) {
            pairPagination.page = 0;
            refreshPair();
        }
    }, 600);
};

window.showPairExportMenu = function() {
    toggleModal(true);
    document.getElementById('modal-title').innerText = 'Export Attendance Pair';
    document.getElementById('modal-content').innerHTML = `
        <div class="text-center mb-4">
            <i class="fas fa-file-excel" style="font-size: 3.5rem; color: var(--secondary); margin-bottom: 1rem;"></i>
            <p class="text-muted">Select the time range for your Excel export.</p>
        </div>
        <div class="flex flex-col gap-3">
            <button class="btn-primary" id="btn-pair-export-filtered">
                <i class="fas fa-globe"></i> Export Data (Based on Current Filters)
            </button>
            <button class="btn-primary" id="btn-pair-export-today" style="background: #4a5568;">
                <i class="fas fa-calendar-day"></i> Export Today Only
            </button>
            <button class="btn-primary" id="btn-pair-export-3days" style="background: #2d3748;">
                <i class="fas fa-calendar-week"></i> Export Last 3 Days
            </button>
            <button class="btn-primary" id="btn-pair-export-absolute" style="background: #1a202c;">
                <i class="fas fa-file-invoice"></i> Export All (Ignored Filters)
            </button>
            <hr style="border: 0; border-top: 1px solid var(--glass-border); margin: 0.5rem 0;">
            <button class="btn-primary" id="btn-pair-print-slip" style="background: var(--secondary); color: white;">
                <i class="fas fa-file-pdf"></i> Generate Monthly Pair (PDF)
            </button>
        </div>
    `;

    document.getElementById('btn-pair-export-filtered').onclick = () => performPairExport('filtered');
    document.getElementById('btn-pair-export-today').onclick = () => performPairExport('today');
    document.getElementById('btn-pair-export-3days').onclick = () => performPairExport('3days');
    document.getElementById('btn-pair-export-absolute').onclick = () => performPairExport('all');
    document.getElementById('btn-pair-print-slip').onclick = showPairPrintSlipModal;

    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.style.display = 'none';
};

async function performPairExport(range) {
    try {
        let fromDate = '';
        let toDate = '';
        let search = '';
        const today = getWitaDateString();

        if (range === 'today') {
            fromDate = today;
            toDate = today;
        } else if (range === '3days') {
            const now = new Date();
            const last3 = new Date();
            last3.setDate(last3.getDate() - 3);
            fromDate = last3.toISOString().split('T')[0];
            toDate = now.toISOString().split('T')[0];
        } else if (range === 'filtered') {
            fromDate = document.getElementById('pair-date-from').value;
            toDate = document.getElementById('pair-date-to').value;
            search = document.getElementById('pair-search').value;
        }

        toggleModal(false);
        showToast('Preparing export data...');

        let url = `/api/pair?limit=${state.EXPORT_LIMIT}`;
        if (fromDate) url += `&from_date=${fromDate}`;
        if (toDate) url += `&to_date=${toDate}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        // Apply the active status filter only for the "based on current filters" export
        const activeStatus = document.getElementById('pair-status')?.value || 'all';
        if (range === 'filtered' && activeStatus && activeStatus !== 'all') url += `&status=${activeStatus}`;
        // Apply the active department filter only for the "based on current filters" export
        const activeDepartment = document.getElementById('pair-department')?.value || 'all';
        if (range === 'filtered' && activeDepartment && activeDepartment !== 'all') url += `&department=${encodeURIComponent(activeDepartment)}`;

        const res = await fetch(url);
        const data = await res.json();
        const summary = data.data?.summary || data.data?.list || data.data || [];

        const exportData = summary.map(item => ({
            Date: item.date,
            NIK: item.nik,
            Name: item.nama,
            'User ID': item.user_id,
            Department: item.department,
            Jabatan: item.jabatan,
            'Check In': item.check_in || '-',
            'Check Out': item.check_out || '-',
            'Work Hours': item.work_hours || '-',
            Status: item.status || (item.check_in && item.check_out ? 'Hadir Penuh' : (item.check_in ? 'Tidak Absen Pulang' : (item.check_out ? 'Tidak Absen Masuk' : 'Tidak Hadir')))
        }));

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance Pair');

        XLSX.writeFile(workbook, `attendance_pair_${range}_${today}.xlsx`);
        showToast('Export successful', 'success');

        if (window.recordClientActivity) {
            await window.recordClientActivity('export_attendance_pair', 'export', `Exported attendance pair (range: ${range}, count: ${summary.length})`);
        }
    } catch (err) {
        showToast('Export failed', 'error');
    }
}

/**
 * Show modal to select employee and month for Monthly Pair PDF
 * Landscape layout with compact professional design
 */
window.showPairPrintSlipModal = async function() {
    // Fetch all employees for the autocomplete
    const res = await fetch('/api/employees?limit=1000');
    const data = await res.json();
    const employees = data.data?.list || data.data || [];

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    toggleModal(true);
    document.getElementById('modal-title').innerHTML = '<i class="fas fa-file-pdf" style="color: var(--secondary);"></i> Generate Monthly Pair (PDF)';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 1.5rem;">
            <i class="fas fa-print" style="font-size: 3rem; color: var(--secondary); margin-bottom: 1rem;"></i>
            <p style="color: var(--text-muted);">Generate a professional monthly attendance pair report in landscape PDF format.</p>
        </div>
        <div class="form-group" style="position: relative;">
            <label>Select Employee</label>
            <div style="position: relative;">
                <input type="text" id="pair-slip-employee-search" placeholder="Search by name or NIK..." 
                    style="width: 100%; padding-right: 2.5rem;" autocomplete="off">
                <i class="fas fa-search" style="position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); opacity: 0.5;"></i>
            </div>
            <input type="hidden" id="pair-slip-employee-id" value="">
            
            <div id="pair-slip-employee-results" class="autocomplete-results" style="display: none;">
            </div>
        </div>
        <div class="form-group">
            <label>Select Month</label>
            <input type="month" id="pair-slip-month" value="${currentMonth}" style="width: 100%;">
        </div>
    `;

    const searchInput = document.getElementById('pair-slip-employee-search');
    const resultsDiv = document.getElementById('pair-slip-employee-results');
    const hiddenId = document.getElementById('pair-slip-employee-id');

    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        if (val.length < 1) {
            resultsDiv.style.display = 'none';
            return;
        }

        const filtered = employees.filter(emp => 
            emp.nama.toLowerCase().includes(val) || 
            (emp.nik && emp.nik.toLowerCase().includes(val)) ||
            emp.user_id.toString().includes(val)
        ).slice(0, 10);

        if (filtered.length > 0) {
            resultsDiv.innerHTML = filtered.map(emp => `
                <div class="autocomplete-item" data-id="${emp.user_id}" data-name="${emp.nama}" data-nik="${emp.nik || '-'}" data-dept="${emp.department || '-'}" data-jabatan="${emp.jabatan || '-'}">
                    <div style="font-weight: 600;">${emp.nama}</div>
                    <div style="font-size: 0.75rem; opacity: 0.7;">NIK: ${emp.nik || '-'} | ID: ${emp.user_id}</div>
                </div>
            `).join('');
            resultsDiv.style.display = 'block';

            resultsDiv.querySelectorAll('.autocomplete-item').forEach(item => {
                item.onclick = () => {
                    searchInput.value = item.dataset.name;
                    hiddenId.value = item.dataset.id;
                    resultsDiv.style.display = 'none';
                };
            });
        } else {
            resultsDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted);">No employee found</div>';
            resultsDiv.style.display = 'block';
        }
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
            resultsDiv.style.display = 'none';
        }
    }, { once: true });

    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.style.display = 'block';
    saveBtn.innerText = 'Generate PDF';
    saveBtn.onclick = generatePairPDFSlip;
};

async function generatePairPDFSlip() {
    const employeeId = document.getElementById('pair-slip-employee-id').value;
    const monthStr = document.getElementById('pair-slip-month').value;

    if (!employeeId || !monthStr) {
        return showToast('Please select employee and month', 'warning');
    }

    try {
        showToast('Fetching attendance data...');
        const [year, month] = monthStr.split('-');
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);

        // Period: 26th of previous month to 25th of selected month
        // Example: April → March 26 to April 25
        let fromDate, toDate, periodLabel;
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

        if (monthNum === 1) {
            // January: Dec 26 last year to Jan 25 this year
            fromDate = `${yearNum - 1}-12-26`;
            toDate = `${yearNum}-01-25`;
            periodLabel = `26 Dec ${yearNum - 1} - 25 Jan ${yearNum}`;
        } else {
            const prevMonth = monthNum - 1;
            fromDate = `${yearNum}-${String(prevMonth).padStart(2, '0')}-26`;
            toDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-25`;
            periodLabel = `26 ${monthNames[prevMonth - 1]} - 25 ${monthNames[monthNum - 1]} ${yearNum}`;
        }

        // Fetch pair data for this employee and period
        const res = await fetch(`/api/pair?user_id=${employeeId}&from_date=${fromDate}&to_date=${toDate}&limit=31`);
        const data = await res.json();
        const summary = data.data?.summary || data.data?.list || data.data || [];

        if (summary.length === 0) {
            return showToast('No data found for this period', 'warning');
        }

        // Get employee info from first record
        const emp = summary[0];

        // Generate PDF in landscape
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('landscape', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        // ===== COLOR PALETTE =====
        const PRIMARY = [0, 102, 204];
        const PRIMARY_DARK = [0, 70, 150];
        const ACCENT = [119, 160, 68];
        const TEXT_DARK = [40, 40, 50];
        const TEXT_MUTED = [100, 110, 130];
        const BG_LIGHT = [245, 248, 252];
        const BG_WHITE = [255, 255, 255];
        const GREEN = [16, 185, 129];
        const AMBER = [245, 158, 11];
        const RED = [239, 68, 68];

        // ===== HEADER SECTION =====
        // Top accent bar
        doc.setFillColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
        doc.rect(0, 0, pageWidth, 5, 'F');

        // Secondary accent bar below
        doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
        doc.rect(0, 5, pageWidth, 1.5, 'F');

        // Company name
        doc.setFontSize(16);
        doc.setTextColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
        doc.setFont(undefined, 'bold');
        doc.text('PT. GUNUNG SAMUDERA INTERNASIONAL', pageWidth / 2, 18, { align: 'center' });

        // Report title with background pill
        const titleText = 'MONTHLY ATTENDANCE PAIR REPORT';
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.setFont(undefined, 'bold');
        const titleW = doc.getTextWidth(titleText) + 12;
        doc.setFillColor(PRIMARY_DARK[0], PRIMARY_DARK[1], PRIMARY_DARK[2]);
        doc.roundedRect((pageWidth - titleW) / 2, 22, titleW, 6, 3, 3, 'F');
        doc.text(titleText, pageWidth / 2, 26.5, { align: 'center' });

        // Divider line
        doc.setDrawColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
        doc.setLineWidth(0.3);
        doc.line(12, 32, pageWidth - 12, 32);

        // ===== EMPLOYEE INFO SECTION =====
        const infoY = 36;
        const col1X = 16;
        const col2X = pageWidth / 2 + 8;
        const lineH = 4.5;

        // Info box background
        doc.setFillColor(BG_LIGHT[0], BG_LIGHT[1], BG_LIGHT[2]);
        doc.roundedRect(12, infoY - 3, pageWidth - 24, lineH * 4 + 4, 2, 2, 'F');
        doc.setDrawColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
        doc.setLineWidth(0.2);
        doc.roundedRect(12, infoY - 3, pageWidth - 24, lineH * 4 + 4, 2, 2, 'S');

        doc.setFontSize(7);
        doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
        doc.setFont(undefined, 'normal');

        // Left column
        doc.text(`Employee  :  ${emp.nama || 'N/A'}`, col1X, infoY);
        doc.text(`NIK           :  ${emp.nik || '-'}`, col1X, infoY + lineH);
        doc.text(`Department :  ${emp.department || '-'}`, col1X, infoY + lineH * 2);
        doc.text(`Position     :  ${emp.jabatan || '-'}`, col1X, infoY + lineH * 3);

        // Right column
        doc.text(`Period        :  ${periodLabel}`, col2X, infoY);
        doc.text(`User ID      :  ${emp.user_id}`, col2X, infoY + lineH);
        doc.text(`Total Days  :  ${summary.length} days`, col2X, infoY + lineH * 2);

        // Calculate stats
        const hadirPenuh = summary.filter(s => s.check_in && s.check_out).length;
        const tidakAbsenPulang = summary.filter(s => s.check_in && !s.check_out).length;
        const tidakAbsenMasuk = summary.filter(s => !s.check_in && s.check_out).length;
        const tidakHadir = summary.filter(s => !s.check_in && !s.check_out).length;
        doc.text(`Hadir Penuh :  ${hadirPenuh} days`, col2X, infoY + lineH * 3);

        // ===== SUMMARY CARDS (above table) =====
        const summaryY = infoY + lineH * 4 + 8;
        const totalTableWidth = pageWidth - 24;
        const startX = 12;
        const alphaBlend = (c, alpha) => [
            Math.round(255 + (c[0] - 255) * alpha),
            Math.round(255 + (c[1] - 255) * alpha),
            Math.round(255 + (c[2] - 255) * alpha)
        ];

        const summaryItems = [
            { label: 'Total Days', value: summary.length, color: PRIMARY },
            { label: 'Hadir Penuh', value: hadirPenuh, color: GREEN },
            { label: 'Tdk Absen Pulang', value: tidakAbsenPulang, color: AMBER },
            { label: 'Tdk Absen Masuk', value: tidakAbsenMasuk, color: RED },
            { label: 'Tidak Hadir', value: tidakHadir, color: RED },
        ];

        const cardW = (totalTableWidth - 12) / 5;
        summaryItems.forEach((item, i) => {
            const cx = startX + i * (cardW + 3);
            const cy = summaryY;
            
            // Card background
            doc.setFillColor(...alphaBlend(item.color, 0.08));
            doc.roundedRect(cx, cy, cardW, 10, 2, 2, 'F');
            
            // Card border
            doc.setDrawColor(item.color[0], item.color[1], item.color[2]);
            doc.setLineWidth(0.3);
            doc.roundedRect(cx, cy, cardW, 10, 2, 2, 'S');
            
            // Value
            doc.setFontSize(9);
            doc.setTextColor(item.color[0], item.color[1], item.color[2]);
            doc.setFont(undefined, 'bold');
            doc.text(item.value.toString(), cx + cardW / 2, cy + 4, { align: 'center' });
            
            // Label
            doc.setFontSize(5);
            doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
            doc.setFont(undefined, 'normal');
            doc.text(item.label, cx + cardW / 2, cy + 8, { align: 'center' });
        });

        // ===== TABLE =====
        const tableTop = summaryY + 14;
        const colWidths = [14, 44, 18, 18, 18, 18, 16, 18, 16, 16, 16];
        const headers = ['Date', 'Name', 'NIK', 'Dept', 'Check In', 'Check Out', 'Work Hrs', 'Status', 'Late', 'Early', 'Overtime'];

        // Header
        doc.setFillColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
        doc.roundedRect(startX, tableTop, totalTableWidth, 6, 2, 2, 'F');

        doc.setFontSize(6);
        doc.setTextColor(255, 255, 255);
        doc.setFont(undefined, 'bold');
        let xPos = startX;
        headers.forEach((h, i) => {
            doc.text(h, xPos + colWidths[i] / 2, tableTop + 4, { align: 'center' });
            xPos += colWidths[i];
        });

        // ===== TABLE BODY =====
        let yPos = tableTop + 6;
        let rowNum = 0;

        summary.forEach((item) => {
            // Check if we need a new page
            if (yPos > pageHeight - 18) {
                doc.setFontSize(5.5);
                doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
                doc.text(`Page ${doc.internal.getNumberOfPages()} | AZRA System | ${new Date().toLocaleString('id-ID')}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
                doc.addPage();
                yPos = 12;
                
                // Re-draw header on new page
                doc.setFillColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
                doc.roundedRect(startX, yPos, totalTableWidth, 6, 2, 2, 'F');
                doc.setFontSize(6);
                doc.setTextColor(255, 255, 255);
                doc.setFont(undefined, 'bold');
                xPos = startX;
                headers.forEach((h, i) => {
                    doc.text(h, xPos + colWidths[i] / 2, yPos + 4, { align: 'center' });
                    xPos += colWidths[i];
                });
                yPos += 6;
            }

            // Alternating row background
            if (rowNum % 2 === 0) {
                doc.setFillColor(BG_LIGHT[0], BG_LIGHT[1], BG_LIGHT[2]);
            } else {
                doc.setFillColor(BG_WHITE[0], BG_WHITE[1], BG_WHITE[2]);
            }
            doc.rect(startX, yPos, totalTableWidth, 5, 'F');

            // Date
            let dateFormatted = item.date || '-';
            if (item.date && item.date.includes('-')) {
                const parts = item.date.split('-');
                dateFormatted = `${parseInt(parts[2])}/${parseInt(parts[1])}`;
            }

            const status = item.status || (item.check_in && item.check_out ? 'Hadir Penuh' : (item.check_in ? 'Tdk Absen Plg' : (item.check_out ? 'Tdk Absen Msuk' : 'Tdk Hdr')));
            const workHours = item.work_hours || '-';

            const rowData = [
                dateFormatted,
                (item.nama || '').substring(0, 20),
                item.nik || '-',
                (item.department || '').substring(0, 7),
                item.check_in || '-',
                item.check_out || '-',
                workHours,
                status,
                '-', '-', '-'
            ];

            doc.setFontSize(5.5);
            doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
            doc.setFont(undefined, 'normal');
            xPos = startX;
            rowData.forEach((val, i) => {
                if (i === 7) {
                    if (val === 'Hadir Penuh') doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
                    else if (val === 'Sedang Bekerja' || val === 'Sdg Bkerja') doc.setTextColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
                    else if (val === 'Tidak Absen Pulang' || val === 'Tdk Absen Plg' || val === 'Blm Plg') doc.setTextColor(AMBER[0], AMBER[1], AMBER[2]);
                    else if (val === 'Tidak Absen Masuk' || val === 'Tdk Absen Msuk' || val === 'Tidak Hadir' || val === 'Tdk Hdr') doc.setTextColor(RED[0], RED[1], RED[2]);
                    else doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
                    doc.setFont(undefined, 'bold');
                } else {
                    doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
                    doc.setFont(undefined, 'normal');
                }
                doc.text(val, xPos + colWidths[i] / 2, yPos + 3.5, { align: 'center' });
                xPos += colWidths[i];
            });

            yPos += 5;
            rowNum++;
        });

        // ===== FOOTER =====
        const footerY = pageHeight - 10;
        doc.setDrawColor(200, 210, 220);
        doc.setLineWidth(0.2);
        doc.line(12, footerY - 1, pageWidth - 12, footerY - 1);

        doc.setFontSize(5.5);
        doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
        doc.text(`Page ${doc.internal.getNumberOfPages()} | AZRA System | ${new Date().toLocaleString('id-ID')}`, pageWidth / 2, footerY + 2, { align: 'center' });

        doc.save(`Monthly_Pair_${emp.nama}_${periodLabel.replace(/ /g, '_')}.pdf`);
        showToast('PDF Generated successfully', 'success');
        toggleModal(false);

        if (window.recordClientActivity) {
            await window.recordClientActivity('export_monthly_pair_pdf', 'export', `Generated monthly pair PDF for ${emp.nama} (${periodLabel})`);
        }
    } catch (err) {
        console.error(err);
        showToast('Failed to generate PDF', 'error');
    }
};

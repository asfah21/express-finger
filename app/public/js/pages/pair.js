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

    // Show skeleton loading
    showSkeleton('pair-body', pairPagination.size);

    let url = `/api/pair?limit=${pairPagination.size}&offset=${pairPagination.page * pairPagination.size}`;
    if (fromDate) url += `&from_date=${fromDate}`;
    if (toDate) url += `&to_date=${toDate}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        const summary = data.data?.summary || [];
        pairPagination.total = data.data?.total || 0;

        const body = document.getElementById('pair-body');
        body.innerHTML = summary.map(item => {
            const status = item.status || (item.check_in && item.check_out ? 'Hadir Penuh' : (item.check_in ? 'Belum Pulang' : 'Tidak Hadir'));
            let statusBadge = 'badge-warning';
            if (status === 'Hadir Penuh') statusBadge = 'badge-success';
            else if (status === 'Tidak Hadir') statusBadge = 'badge-error';

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

window.applyPairFilter = function() {
    pairPagination.page = 0;
    refreshPair();
};

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

        const res = await fetch(url);
        const data = await res.json();
        const summary = data.data?.summary || [];

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
            Status: item.status || (item.check_in && item.check_out ? 'Hadir Penuh' : (item.check_in ? 'Belum Pulang' : 'Tidak Hadir'))
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
    const employees = data.data?.list || [];

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
        const lastDay = new Date(year, month, 0).getDate();
        const fromDate = `${monthStr}-01`;
        const toDate = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

        // Fetch pair data for this employee and month
        const res = await fetch(`/api/pair?user_id=${employeeId}&from_date=${fromDate}&to_date=${toDate}&limit=31`);
        const data = await res.json();
        const summary = data.data?.summary || [];

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

        // ===== HEADER SECTION =====
        // Top accent line
        doc.setFillColor(0, 102, 204);
        doc.rect(0, 0, pageWidth, 4, 'F');

        // Company name
        doc.setFontSize(18);
        doc.setTextColor(0, 102, 204);
        doc.setFont(undefined, 'bold');
        doc.text('PT. GLOBAL SUKSES INDONESIA', pageWidth / 2, 16, { align: 'center' });

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.setFont(undefined, 'normal');
        doc.text('MONTHLY ATTENDANCE PAIR REPORT', pageWidth / 2, 22, { align: 'center' });

        // Divider
        doc.setDrawColor(0, 102, 204);
        doc.setLineWidth(0.3);
        doc.line(10, 26, pageWidth - 10, 26);

        // ===== EMPLOYEE INFO SECTION (compact 2-column) =====
        doc.setFontSize(8);
        doc.setTextColor(80);
        doc.setFont(undefined, 'bold');
        
        const infoX = 14;
        const infoY = 32;
        const col1X = infoX;
        const col2X = pageWidth / 2 + 10;
        const lineH = 4.5;

        doc.setFont(undefined, 'normal');
        doc.text(`Employee Name  :  ${emp.nama || 'N/A'}`, col1X, infoY);
        doc.text(`NIK                    :  ${emp.nik || '-'}`, col1X, infoY + lineH);
        doc.text(`Department       :  ${emp.department || '-'}`, col1X, infoY + lineH * 2);
        doc.text(`Position            :  ${emp.jabatan || '-'}`, col1X, infoY + lineH * 3);

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        doc.text(`Period                :  ${monthNames[parseInt(month) - 1]} ${year}`, col2X, infoY);
        doc.text(`User ID              :  ${emp.user_id}`, col2X, infoY + lineH);
        doc.text(`Total Days         :  ${summary.length} days`, col2X, infoY + lineH * 2);
        
        // Calculate stats
        const hadirPenuh = summary.filter(s => s.check_in && s.check_out).length;
        const belumPulang = summary.filter(s => s.check_in && !s.check_out).length;
        const tidakHadir = summary.filter(s => !s.check_in && !s.check_out).length;
        doc.text(`Hadir Penuh      :  ${hadirPenuh} days`, col2X, infoY + lineH * 3);

        // ===== TABLE HEADER =====
        const tableTop = 48;
        const colWidths = [18, 50, 22, 22, 22, 22, 22, 22, 22, 22, 22];
        const headers = ['Date', 'Name', 'NIK', 'Dept', 'Check In', 'Check Out', 'Work Hrs', 'Status', 'Late', 'Early', 'Overtime'];
        
        // Calculate total width
        const totalTableWidth = colWidths.reduce((a, b) => a + b, 0);
        const startX = (pageWidth - totalTableWidth) / 2;

        // Header background
        doc.setFillColor(0, 102, 204);
        doc.rect(startX, tableTop, totalTableWidth, 7, 'F');

        // Header text
        doc.setFontSize(7);
        doc.setTextColor(255);
        doc.setFont(undefined, 'bold');
        let xPos = startX;
        headers.forEach((h, i) => {
            doc.text(h, xPos + colWidths[i] / 2, tableTop + 4.5, { align: 'center' });
            xPos += colWidths[i];
        });

        // ===== TABLE BODY =====
        let yPos = tableTop + 7;
        let rowNum = 0;

        summary.forEach((item, idx) => {
            // Check if we need a new page
            if (yPos > pageHeight - 20) {
                // Footer on current page
                doc.setFontSize(6);
                doc.setTextColor(150);
                doc.text(`Page ${doc.internal.getNumberOfPages()} | Generated by AZRA System`, pageWidth / 2, pageHeight - 8, { align: 'center' });
                
                doc.addPage();
                yPos = 15;
                
                // Re-draw header on new page
                doc.setFillColor(0, 102, 204);
                doc.rect(startX, yPos, totalTableWidth, 7, 'F');
                doc.setFontSize(7);
                doc.setTextColor(255);
                doc.setFont(undefined, 'bold');
                xPos = startX;
                headers.forEach((h, i) => {
                    doc.text(h, xPos + colWidths[i] / 2, yPos + 4.5, { align: 'center' });
                    xPos += colWidths[i];
                });
                yPos += 7;
            }

            // Row background (alternating)
            if (rowNum % 2 === 0) {
                doc.setFillColor(245, 248, 252);
            } else {
                doc.setFillColor(255, 255, 255);
            }
            doc.rect(startX, yPos, totalTableWidth, 6, 'F');

            // Date
            let dateFormatted = item.date || '-';
            if (item.date && item.date.includes('-')) {
                const parts = item.date.split('-');
                dateFormatted = `${parseInt(parts[2])}/${parseInt(parts[1])}`;
            }

            // Status
            const status = item.status || (item.check_in && item.check_out ? 'Hadir Penuh' : (item.check_in ? 'Blm Plg' : 'Tdk Hdr'));

            // Work hours
            const workHours = item.work_hours || '-';

            // Late / Early / Overtime (placeholder - could be enhanced with actual data)
            const late = item.late || '-';
            const early = item.early || '-';
            const overtime = item.overtime || '-';

            const rowData = [
                dateFormatted,
                (item.nama || '').substring(0, 20),
                item.nik || '-',
                (item.department || '').substring(0, 8),
                item.check_in || '-',
                item.check_out || '-',
                workHours,
                status,
                late,
                early,
                overtime
            ];

            doc.setFontSize(6.5);
            doc.setTextColor(60);
            doc.setFont(undefined, 'normal');
            xPos = startX;
            rowData.forEach((val, i) => {
                doc.text(val, xPos + colWidths[i] / 2, yPos + 4, { align: 'center' });
                xPos += colWidths[i];
            });

            yPos += 6;
            rowNum++;
        });

        // ===== SUMMARY SECTION =====
        yPos += 4;
        doc.setDrawColor(0, 102, 204);
        doc.setLineWidth(0.3);
        doc.line(startX, yPos, startX + totalTableWidth, yPos);
        yPos += 5;

        doc.setFontSize(8);
        doc.setTextColor(0, 102, 204);
        doc.setFont(undefined, 'bold');
        doc.text('ATTENDANCE SUMMARY', startX, yPos);
        yPos += 5;

        doc.setFontSize(7);
        doc.setTextColor(80);
        doc.setFont(undefined, 'normal');

        const summaryItems = [
            { label: 'Total Working Days', value: summary.length },
            { label: 'Hadir Penuh (Full Day)', value: hadirPenuh, color: [16, 185, 129] },
            { label: 'Belum Pulang (No Check-out)', value: belumPulang, color: [245, 158, 11] },
            { label: 'Tidak Hadir (Absent)', value: tidakHadir, color: [239, 68, 68] },
        ];

        const summaryStartX = startX;
        summaryItems.forEach((item, i) => {
            const sx = summaryStartX + (i % 4) * (totalTableWidth / 4);
            const sy = yPos + Math.floor(i / 4) * 6;
            
            if (item.color) {
                doc.setTextColor(item.color[0], item.color[1], item.color[2]);
            } else {
                doc.setTextColor(60);
            }
            doc.setFont(undefined, 'bold');
            doc.text(item.value.toString(), sx + 15, sy);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(100);
            doc.text(item.label, sx + 22, sy);
        });

        // ===== FOOTER =====
        doc.setFontSize(6);
        doc.setTextColor(150);
        doc.text(`Page ${doc.internal.getNumberOfPages()} | Generated by AZRA System | ${new Date().toLocaleString('id-ID')}`, pageWidth / 2, pageHeight - 8, { align: 'center' });

        // Signature line
        doc.setFontSize(7);
        doc.setTextColor(80);
        doc.text('Printed by AZRA System', startX, pageHeight - 16);
        doc.text('Manager / Supervisor,', startX + totalTableWidth - 50, pageHeight - 16);
        doc.text('( ____________________ )', startX + totalTableWidth - 50, pageHeight - 10);

        doc.save(`Monthly_Pair_${emp.nama}_${monthStr}.pdf`);
        showToast('PDF Generated successfully', 'success');
        toggleModal(false);

        if (window.recordClientActivity) {
            await window.recordClientActivity('export_monthly_pair_pdf', 'export', `Generated monthly pair PDF for ${emp.nama} (${monthStr})`);
        }
    } catch (err) {
        console.error(err);
        showToast('Failed to generate PDF', 'error');
    }
};

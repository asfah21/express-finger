import { state } from '../state.js';
import { showToast, toggleModal, getWitaDateString } from '../utils.js';

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
        </div>
    `;

    document.getElementById('btn-pair-export-filtered').onclick = () => performPairExport('filtered');
    document.getElementById('btn-pair-export-today').onclick = () => performPairExport('today');
    document.getElementById('btn-pair-export-3days').onclick = () => performPairExport('3days');
    document.getElementById('btn-pair-export-absolute').onclick = () => performPairExport('all');

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

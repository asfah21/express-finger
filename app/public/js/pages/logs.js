import { state } from '../state.js';
import { showToast, toggleModal, getWitaDateString, getBusinessTimeParts, BUSINESS_TIME_ZONE } from '../utils.js';
import { showSkeleton } from '../skeleton.js';

// Default the From/To date filters to today (WITA) on every page open,
// but never overwrite a date range the user has already selected.
function setDefaultLogDates() {
    const fromEl = document.getElementById('log-date-from');
    const toEl = document.getElementById('log-date-to');
    const today = getWitaDateString();
    if (fromEl && !fromEl.value) fromEl.value = today;
    if (toEl && !toEl.value) toEl.value = today;
}

function logRowHtml(log) {
    // Keep the UI aligned with the Excel export: the API timestamp is already
    // normalized to the business timezone, so read its UTC calendar fields
    // instead of converting it through the browser's local timezone again.
    const displayParts = getExportTimestampParts(log.timestamp);
    const dateStr = `${displayParts.day}/${displayParts.month}/${displayParts.year}`;
    const timeStr = `${displayParts.hour}:${displayParts.minute}`;
    const secondsStr = displayParts.second;

    return `
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
    `;
}

function buildLogRowElement(log) {
    const tr = document.createElement('tr');
    tr.dataset.id = String(log.id ?? '');
    tr.innerHTML = logRowHtml(log);
    return tr;
}

function emptyLogsRow() {
    return `<tr><td colspan="7" class="empty-state">
        <i class="fas fa-clipboard-list"></i>
        <div class="empty-title">No Attendance Logs Found</div>
        <div class="empty-subtitle">Try adjusting your search filters or date range, or pull data from devices first.</div>
    </td></tr>`;
}

/**
 * Diff-merge new rows into the logs table without a full re-render.
 * Existing <tr> nodes (keyed by data-id) are reused and only repositioned, so
 * unchanged rows keep their DOM identity and the table never blinks/flashes.
 */
function applySilentLogs(logs) {
    const body = document.getElementById('logs-body');
    if (!body) return;

    if (logs.length === 0) {
        body.innerHTML = emptyLogsRow();
        return;
    }

    const existing = new Map();
    for (const tr of body.querySelectorAll('tr[data-id]')) {
        existing.set(tr.dataset.id, tr);
    }

    let changed = existing.size !== logs.length;
    const frag = document.createDocumentFragment();
    for (const log of logs) {
        const id = String(log.id);
        const tr = existing.get(id);
        if (tr) {
            existing.delete(id);
            frag.appendChild(tr);
        } else {
            changed = true;
            frag.appendChild(buildLogRowElement(log));
        }
    }
    if (existing.size > 0) changed = true;

    if (changed) body.replaceChildren(frag);
}

export async function refreshLogs({ silent = false } = {}) {
    setDefaultLogDates();
    const s = state.pagination.logs;
    const fromDate = document.getElementById('log-date-from').value;
    const toDate = document.getElementById('log-date-to').value;
    const search = document.getElementById('log-search').value;
    const source = document.getElementById('log-source')?.value || 'all';

    // Silent (realtime) refreshes skip the skeleton so the table does not blink.
    if (!silent) showSkeleton('logs-body', s.size);

    let url = `/api/logs?limit=${s.size}&offset=${s.page * s.size}`;
    if (fromDate) url += `&from=${encodeURIComponent(`${fromDate}T00:00:00+08:00`)}`;
    if (toDate) url += `&to=${encodeURIComponent(`${toDate}T23:59:59.999+08:00`)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (source && source !== 'all') url += `&source=${encodeURIComponent(source)}`;

    const res = await fetch(url);
    const data = await res.json();

    s.total = data.data?.total || 0;
    const body = document.getElementById('logs-body');
    const logs = data.data?.list || data.data?.logs || [];

    if (silent) {
        applySilentLogs(logs);
    } else if (logs.length === 0) {
        body.innerHTML = emptyLogsRow();
    } else {
        body.innerHTML = logs.map(logRowHtml).join('');
    }

    window.updatePaginationUI('logs');
}

// ---------------------------------------------------------------------------
// Realtime (SSE) support — payload-aware, blink-free updates (#1 & #2).
// ---------------------------------------------------------------------------

// Map an SSE event's `source` tag to the /logs SOURCE filter buckets.
const FINGERPRINT_SOURCES = new Set(['iclock', 'pull', 'pull-on-contact']);
const KIOSK_SOURCES = new Set(['live-cam', 'live-cam-multi', 'LIVE-CAM', 'LIVE-CAM-MULTI']);

function eventSourceIsFingerprint(source) {
    return FINGERPRINT_SOURCES.has(source);
}

function eventSourceIsKiosk(source) {
    return KIOSK_SOURCES.has(source);
}

function currentLogSourceFilter() {
    return document.getElementById('log-source')?.value || 'all';
}

// Does the current SOURCE filter permit an event originating from `eventSource`?
function logsSourceAllows(eventSource) {
    const filter = currentLogSourceFilter();
    if (filter === 'all') return true;
    if (filter === 'fingerprint') return eventSourceIsFingerprint(eventSource);
    if (filter === 'kiosk') return eventSourceIsKiosk(eventSource);
    return true;
}

function currentLogRange() {
    return {
        from: document.getElementById('log-date-from')?.value || '',
        to: document.getElementById('log-date-to')?.value || ''
    };
}

// Does the new record's timestamp fall inside the current FROM/TO range?
function logsRangeIncludesTimestamp(ts) {
    if (!ts) return true;
    const { from, to } = currentLogRange();
    if (!from && !to) return true;
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) return true;
    if (from && t < new Date(`${from}T00:00:00+08:00`).getTime()) return false;
    if (to && t > new Date(`${to}T23:59:59.999+08:00`).getTime()) return false;
    return true;
}

// Does the current FROM/TO range include today (WITA)? Used for `bulk` events,
// which carry no timestamp — new logs are always written at "now".
function logsRangeIncludesToday() {
    const today = getWitaDateString(); // YYYY-MM-DD in Asia/Makassar
    const { from, to } = currentLogRange();
    if (!from && !to) return true;
    if (from && today < from) return false;
    if (to && today > to) return false;
    return true;
}

/**
 * Should the /logs table skip refreshing for this realtime event?
 * Returns true when the event cannot affect the currently visible rows:
 *   - the SOURCE filter excludes the event's device family, or
 *   - the selected date range doesn't include today (bulk events carry no ts).
 *
 * @param {string|null} eventSource - SSE payload `source`; null → kiosk camera.
 */
export function shouldSkipLogsRefresh(eventSource) {
    const src = eventSource || 'live-cam';
    if (!logsSourceAllows(src)) return true;
    if (!logsRangeIncludesToday()) return true;
    return false;
}

/**
 * Apply a single `attendance:new` event (full row payload) directly, without
 * refetching the whole page. Falls back to a silent refresh when the payload
 * can't be safely validated (active search box).
 *
 * @returns {boolean|Promise} true if rendered directly, false if skipped, or a
 *                            Promise when it fell back to a silent refresh.
 */
export function applyLiveAttendanceNew(payload) {
    if (!payload || payload.id == null) return refreshLogs({ silent: true });

    // Skip when the SOURCE filter excludes kiosk/camera events.
    if (!logsSourceAllows('live-cam')) return false;
    // Skip when the row's timestamp falls outside the selected date range.
    if (!logsRangeIncludesTimestamp(payload.timestamp)) return false;

    const body = document.getElementById('logs-body');
    if (!body) return false;

    // Already showing this row — nothing to do.
    for (const tr of body.querySelectorAll('tr[data-id]')) {
        if (tr.dataset.id === String(payload.id)) return false;
    }

    // With an active search box we can't reliably know whether this row matches;
    // a silent refresh keeps the filtered list correct without the skeleton.
    const search = (document.getElementById('log-search')?.value || '').trim().toLowerCase();
    if (search) {
        const name = (payload.nama || '').toLowerCase();
        const nik = (payload.nik || '').toLowerCase();
        const uid = String(payload.user_id ?? '');
        if (!name.includes(search) && !nik.includes(search) && !uid.includes(search)) {
            return false; // row wouldn't appear under this search filter
        }
        return refreshLogs({ silent: true });
    }

    // Prepend at the top (API sorts by timestamp DESC).
    const first = body.querySelector('tr[data-id]');
    const row = buildLogRowElement(payload);
    if (first) body.insertBefore(row, first);
    else body.appendChild(row);

    // Keep page size consistent: drop the oldest row when we exceed it.
    const s = state.pagination.logs;
    const rows = body.querySelectorAll('tr[data-id]');
    if (rows.length > s.size) rows[rows.length - 1].remove();

    // Keep the total consistent while viewing the first page.
    if (s.page === 0) {
        s.total += 1;
        window.updatePaginationUI('logs');
    }
    return true;
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
        <div class="form-group" style="position: relative;">
            <label>Select Employee</label>
            <div style="position: relative;">
                <input type="text" id="slip-employee-search" placeholder="Search by name or NIK..." 
                    style="width: 100%; padding-right: 2.5rem;" autocomplete="off">
                <i class="fas fa-search" style="position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); opacity: 0.5;"></i>
            </div>
            <input type="hidden" id="slip-employee-id" value="">
            
            <div id="slip-employee-results" class="autocomplete-results" style="display: none;">
                <!-- Results will be injected here -->
            </div>
        </div>
        <div class="form-group">
            <label>Select Month</label>
            <input type="month" id="slip-month" value="${currentMonth}" style="width: 100%;">
        </div>
    `;

    const searchInput = document.getElementById('slip-employee-search');
    const resultsDiv = document.getElementById('slip-employee-results');
    const hiddenId = document.getElementById('slip-employee-id');

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
                <div class="autocomplete-item" data-id="${emp.user_id}" data-name="${emp.nama}">
                    <div style="font-weight: 600;">${emp.nama}</div>
                    <div style="font-size: 0.75rem; opacity: 0.7;">NIK: ${emp.nik || '-'} | ID: ${emp.user_id}</div>
                </div>
            `).join('');
            resultsDiv.style.display = 'block';

            // Add click handlers for items
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

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
            resultsDiv.style.display = 'none';
        }
    }, { once: true });

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
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

        // Period: 26th of previous month to 25th of selected month
        let fromDate, toDate, periodLabel;
        if (monthNum === 1) {
            fromDate = `${yearNum - 1}-12-26T00:00:00%2B08:00`;
            toDate = `${yearNum}-01-25T23:59:59%2B08:00`;
            periodLabel = `26 Dec ${yearNum - 1} - 25 Jan ${yearNum}`;
        } else {
            const prevMonth = monthNum - 1;
            fromDate = `${yearNum}-${String(prevMonth).padStart(2, '0')}-26T00:00:00%2B08:00`;
            toDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-25T23:59:59%2B08:00`;
            periodLabel = `26 ${monthNames[prevMonth - 1]} - 25 ${monthNames[monthNum - 1]} ${yearNum}`;
        }

        const res = await fetch(`/api/logs?user_id=${employeeId}&from=${fromDate}&to=${toDate}&limit=1000`);
        const data = await res.json();
        const logs = data.data?.list || data.data?.logs || [];

        if (logs.length === 0) {
            return showToast('No data found for this period', 'warning');
        }

        const employee = logs[0]; // Info employee dari log pertama

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

        // ===== HEADER =====
        // Top accent bar
        doc.setFillColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
        doc.rect(0, 0, pageWidth, 5, 'F');
        doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
        doc.rect(0, 5, pageWidth, 1.5, 'F');

        // Company name
        doc.setFontSize(16);
        doc.setTextColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
        doc.setFont(undefined, 'bold');
        doc.text('PT. GUNUNG SAMUDERA INTERNASIONAL', pageWidth / 2, 18, { align: 'center' });

        // Report title pill
        const titleText = 'MONTHLY ATTENDANCE SLIP';
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.setFont(undefined, 'bold');
        const titleW = doc.getTextWidth(titleText) + 12;
        doc.setFillColor(PRIMARY_DARK[0], PRIMARY_DARK[1], PRIMARY_DARK[2]);
        doc.roundedRect((pageWidth - titleW) / 2, 22, titleW, 6, 3, 3, 'F');
        doc.text(titleText, pageWidth / 2, 26.5, { align: 'center' });

        // Divider
        doc.setDrawColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
        doc.setLineWidth(0.3);
        doc.line(12, 32, pageWidth - 12, 32);

        // ===== EMPLOYEE INFO =====
        const infoY = 36;
        const col1X = 16;
        const col2X = pageWidth / 2 + 8;
        const lineH = 4.5;

        // Info box
        doc.setFillColor(BG_LIGHT[0], BG_LIGHT[1], BG_LIGHT[2]);
        doc.roundedRect(12, infoY - 3, pageWidth - 24, lineH * 4 + 4, 2, 2, 'F');
        doc.setDrawColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
        doc.setLineWidth(0.2);
        doc.roundedRect(12, infoY - 3, pageWidth - 24, lineH * 4 + 4, 2, 2, 'S');

        doc.setFontSize(7);
        doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
        doc.setFont(undefined, 'normal');

        doc.text(`Employee  :  ${employee.nama || 'N/A'}`, col1X, infoY);
        doc.text(`NIK           :  ${employee.nik || '-'}`, col1X, infoY + lineH);
        doc.text(`Department :  ${employee.department || '-'}`, col1X, infoY + lineH * 2);
        doc.text(`Position     :  ${employee.jabatan || '-'}`, col1X, infoY + lineH * 3);

        doc.text(`Period        :  ${periodLabel}`, col2X, infoY);
        doc.text(`User ID      :  ${employee.user_id}`, col2X, infoY + lineH);
        doc.text(`Total Logs  :  ${logs.length} entries`, col2X, infoY + lineH * 2);

        // Count check-in vs check-out
        const checkIn = logs.filter(l => l.type == 0).length;
        const checkOut = logs.filter(l => l.type == 1).length;
        doc.text(`Check In/Out :  ${checkIn} / ${checkOut}`, col2X, infoY + lineH * 3);

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
            { label: 'Total Logs', value: logs.length, color: PRIMARY },
            { label: 'Check In', value: checkIn, color: GREEN },
            { label: 'Check Out', value: checkOut, color: AMBER },
            { label: 'Devices', value: [...new Set(logs.map(l => l.device_sn))].length, color: RED },
        ];

        const cardW = (totalTableWidth - 9) / 4;
        summaryItems.forEach((item, i) => {
            const cx = startX + i * (cardW + 3);
            const cy = summaryY;

            // Card background
            doc.setFillColor(...alphaBlend(item.color, 0.08));
            doc.roundedRect(cx, cy, cardW, 10, 2, 2, 'F');

            doc.setDrawColor(item.color[0], item.color[1], item.color[2]);
            doc.setLineWidth(0.3);
            doc.roundedRect(cx, cy, cardW, 10, 2, 2, 'S');

            doc.setFontSize(9);
            doc.setTextColor(item.color[0], item.color[1], item.color[2]);
            doc.setFont(undefined, 'bold');
            doc.text(item.value.toString(), cx + cardW / 2, cy + 4, { align: 'center' });

            doc.setFontSize(5);
            doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
            doc.setFont(undefined, 'normal');
            doc.text(item.label, cx + cardW / 2, cy + 8, { align: 'center' });
        });

        // ===== TABLE =====
        const tableTop = summaryY + 14;
        const colWidths = [14, 44, 18, 18, 18, 18, 16, 18, 22, 22];
        const headers = ['Date', 'Name', 'NIK', 'Dept', 'Time', 'Status', 'Device', 'Type', 'Remarks'];

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

        // Body
        let yPos = tableTop + 6;
        let rowNum = 0;

        logs.forEach((log) => {
            if (yPos > pageHeight - 18) {
                doc.setFontSize(5.5);
                doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
                doc.text(`Page ${doc.internal.getNumberOfPages()} | AZRA System | ${new Date().toLocaleString('id-ID')}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
                doc.addPage();
                yPos = 12;

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

            // Alternating row
            if (rowNum % 2 === 0) {
                doc.setFillColor(BG_LIGHT[0], BG_LIGHT[1], BG_LIGHT[2]);
            } else {
                doc.setFillColor(BG_WHITE[0], BG_WHITE[1], BG_WHITE[2]);
            }
            doc.rect(startX, yPos, totalTableWidth, 5, 'F');

            const displayParts = getExportTimestampParts(log.timestamp);
            const dateStr = `${displayParts.day}/${displayParts.month}`;
            const timeStr = `${displayParts.hour}:${displayParts.minute}:${displayParts.second}`;
            const typeLabel = log.type == 0 ? 'Masuk' : (log.type == 1 ? 'Pulang' : log.absensi || '-');
            const deviceName = (log.device_name || log.device_sn || '-').substring(0, 10);

            const rowData = [
                dateStr,
                (log.nama || '').substring(0, 20),
                log.nik || '-',
                (log.department || '').substring(0, 7),
                timeStr,
                typeLabel,
                deviceName,
                log.type == 0 ? 'IN' : 'OUT',
                (log.ket || '-').substring(0, 14)
            ];

            doc.setFontSize(5.5);
            doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
            doc.setFont(undefined, 'normal');
            xPos = startX;
            rowData.forEach((val, i) => {
                // Color the type cell
                if (i === 7) {
                    if (val === 'IN') doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
                    else doc.setTextColor(AMBER[0], AMBER[1], AMBER[2]);
                    doc.setFont(undefined, 'bold');
                } else if (i === 5) {
                    if (log.type == 0) doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
                    else doc.setTextColor(AMBER[0], AMBER[1], AMBER[2]);
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

        doc.save(`Slip_${employee.nama}_${periodLabel.replace(/ /g, '_')}.pdf`);
        showToast('PDF Generated successfully', 'success');
        toggleModal(false);

        if (window.recordClientActivity) {
            await window.recordClientActivity('export_monthly_slip_pdf', 'export', `Generated monthly slip PDF for ${employee.nama} (${periodLabel})`);
        }
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
        let source = document.getElementById('log-source')?.value || 'all';
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
            source = 'all'; // Ekspor penuh mengabaikan semua filter termasuk sumber
        } else {
            fromDate = document.getElementById('log-date-from').value;
            toDate = document.getElementById('log-date-to').value;
        }

        toggleModal(false);
        showToast('Preparing export data...');

        let url = `/api/logs?limit=${state.EXPORT_LIMIT}`;
        if (range === '3days') {
            url += `&from=${fromDate}&to=${toDate}`;
        } else {
            if (fromDate) url += `&from=${fromDate}T00:00:00%2B08:00`;
            if (toDate) url += `&to=${toDate}T23:59:59%2B08:00`;
        }
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (source && source !== 'all') url += `&source=${encodeURIComponent(source)}`;

        const res = await fetch(url);
        const data = await res.json();
        const logs = data.data?.list || data.data?.logs || [];

        const exportData = logs.map(log => {
            const displayParts = getExportTimestampParts(log.timestamp);
            const timeFull = `${displayParts.hour}:${displayParts.minute}:${displayParts.second}`;
            return {
                NIK: log.nik,
                Name: log.nama,
                'User ID': log.user_id,
                Department: log.department,
                Divisi: log.divisi,
                Jabatan: log.jabatan,
                Status: log.absensi,
                Date: `${displayParts.day}/${displayParts.month}/${displayParts.year}`,
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

/**
 * Match the timestamp interpretation used by the attendance export.
 * PostgreSQL returns the TIMESTAMPTZ value as an ISO instant; using UTC
 * getters here preserves the already-normalized business-time fields and
 * avoids an additional +08:00 browser conversion.
 */
function getExportTimestampParts(value) {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) {
        return { day: '-', month: '-', year: '-', hour: '--', minute: '--', second: '--' };
    }

    return {
        day: String(dt.getUTCDate()).padStart(2, '0'),
        month: String(dt.getUTCMonth() + 1).padStart(2, '0'),
        year: String(dt.getUTCFullYear()),
        hour: String(dt.getUTCHours()).padStart(2, '0'),
        minute: String(dt.getUTCMinutes()).padStart(2, '0'),
        second: String(dt.getUTCSeconds()).padStart(2, '0')
    };
}

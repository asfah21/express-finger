import { showToast, showConfirm } from '../utils.js';

// Pull Page State
export let lastPulledData = [];
export let pullPageState = { page: 1, limit: 10 };
export let _currentPullView = 'presensi'; // 'presensi' or 'raw'

export async function refreshPull() {
    try {
        const res = await fetch('/api/devices');
        const data = await res.json();
        const select = document.getElementById('pull-device-select');
        const devices = data.data?.list || [];
        
        // Simpan SN yang sedang terpilih jika ada
        const currentSn = select.value;
        
        select.innerHTML = '<option value="">-- Select Device --</option>' + 
            devices.map(d => `<option value="${d.sn}" ${d.sn === currentSn ? 'selected' : ''}>${d.name || d.ip} (${d.sn})</option>`).join('');
    } catch (err) {
        console.error('Failed to load devices for pull', err);
    }
}

export async function handlePullData() {
    const sn = document.getElementById('pull-device-select').value;
    if (!sn) return showToast('Please select a device', 'warning');

    const btn = document.getElementById('btn-pull-action');
    const container = document.getElementById('pull-results-container');
    const emptyState = document.getElementById('pull-empty-state');

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Pulling Data...';
    
    try {
        // We use mode=preview to just fetch without saving to DB
        const res = await fetch(`/api/pull?sn=${sn}&mode=preview`);
        const data = await res.json();

        if (res.ok && data.status === 'success') {
            lastPulledData = data.data?.logs || [];
            showToast(`Successfully pulled ${lastPulledData.length} logs`, 'success');
            
            if (lastPulledData.length > 0) {
                container.style.display = 'block';
                emptyState.style.display = 'none';
                pullPageState.page = 1;
                renderPullResults(lastPulledData);
            } else {
                container.style.display = 'none';
                emptyState.style.display = 'block';
                emptyState.innerHTML = '<i class="fas fa-info-circle"></i> No new logs found on device.';
            }
        } else {
            showToast(data.message || 'Failed to pull data', 'error');
        }
    } catch (err) {
        showToast('Network error during pull', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i> Pull & Preview Data';
    }
}

export function renderPullResults(logs) {
    if (!logs) return;

    const isPresensi = _currentPullView === 'presensi';
    const dataToRender = logs;

    const total = dataToRender.length;
    renderPullPagination(total);

    const start = (pullPageState.page - 1) * pullPageState.limit;
    const paged = dataToRender.slice(start, start + pullPageState.limit);

    if (isPresensi) {
        const presensiBody = document.getElementById('pull-presensi-body');
        presensiBody.innerHTML = paged.map(log => {
            const dt = new Date(log.timestamp);
            const dateStr = dt.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const absensi = log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang');
            const badgeCls = absensi.startsWith('Pulang') ? 'badge-warning' : (absensi.startsWith('Masuk') ? 'badge-success' : 'badge-info');

            return `<tr>
                <td><strong>${log.userId}</strong></td>
                <td>${log.name || 'Unknown'}</td>
                <td>${dateStr}</td>
                <td><strong style="color: var(--primary);">${timeStr}</strong></td>
                <td><span class="badge ${badgeCls}">${absensi}</span></td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Tidak ada data</td></tr>';
    } else {
        const rawBody = document.getElementById('pull-raw-body');
        rawBody.innerHTML = paged.map(log => {
            const dt = new Date(log.timestamp);
            const dateStr = isNaN(dt.getTime()) ? log.timestamp : dt.toLocaleString('id-ID');
            const absensi = log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang');
            const badgeCls = absensi.startsWith('Pulang') ? 'badge-warning' : (absensi.startsWith('Masuk') ? 'badge-success' : 'badge-info');
            return `<tr>
                <td><strong>${log.userId}</strong></td>
                <td>${dateStr}</td>
                <td><span class="badge ${badgeCls}">${absensi}</span></td>
            </tr>`;
        }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);">Tidak ada data</td></tr>';
    }
}

export function changePullView(view) {
    _currentPullView = view;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.tab-btn[onclick*="${view}"]`).classList.add('active');

    if (view === 'presensi') {
        document.getElementById('pull-presensi-view').style.display = 'block';
        document.getElementById('pull-raw-view').style.display = 'none';
    } else {
        document.getElementById('pull-presensi-view').style.display = 'none';
        document.getElementById('pull-raw-view').style.display = 'block';
    }
    renderPullResults(lastPulledData);
}

export function renderPullPagination(total) {
    const totalPages = Math.ceil(total / pullPageState.limit);
    document.getElementById('pull-page-info').innerText = `Page ${pullPageState.page} of ${totalPages || 1} (${total} items)`;
    document.getElementById('btn-pull-prev').disabled = pullPageState.page <= 1;
    document.getElementById('btn-pull-next').disabled = pullPageState.page >= totalPages;
}

export function nextPullPage() {
    pullPageState.page++;
    renderPullResults(lastPulledData);
}

export function prevPullPage() {
    pullPageState.page--;
    renderPullResults(lastPulledData);
}

export async function savePulledLogs() {
    if (!lastPulledData || lastPulledData.length === 0) return;

    showConfirm({
        title: 'Sync to Database',
        message: `You are about to save <strong>${lastPulledData.length}</strong> logs to the main attendance system. Duplicate logs will be automatically handled.`,
        icon: 'fa-database',
        confirmText: 'Save to Main Database',
        onConfirm: async () => {
            const sn = document.getElementById('pull-device-select').value;
            const btn = document.getElementById('btn-save-pull');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

            try {
                // Now we pull with mode=sync to actually save
                const res = await fetch(`/api/pull?sn=${sn}&mode=sync`);
                const data = await res.json();
                
                if (res.ok) {
                    showToast(data.message || 'Data synchronized successfully', 'success');
                    // Clear preview
                    lastPulledData = [];
                    document.getElementById('pull-results-container').style.display = 'none';
                    document.getElementById('pull-empty-state').style.display = 'block';
                    document.getElementById('pull-empty-state').innerHTML = '<i class="fas fa-check-circle" style="color:var(--success)"></i> Data successfully synchronized to database.';
                } else {
                    showToast(data.message || 'Sync failed', 'error');
                }
            } catch (err) {
                showToast('Network error during sync', 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check"></i> Fix & Sync to Database';
            }
        }
    });
}

export function exportPulledData() {
    if (!lastPulledData || lastPulledData.length === 0) {
        showToast('No data to export', 'warning');
        return;
    }

    try {
        let csvContent, filename;

        if (_currentPullView === 'presensi') {
            const headers = ['User ID', 'Name', 'Date', 'Time', 'Type'];
            const rows = lastPulledData.map(log => {
                const dt = new Date(log.timestamp);
                const dateStr = dt.toISOString().slice(0, 10);
                const timeStr = dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                return [
                    log.userId,
                    log.name || 'Unknown',
                    dateStr,
                    timeStr,
                    log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang')
                ].map(v => `"${v}"`).join(',');
            });
            csvContent = [headers.join(','), ...rows].join('\n');
            filename = `summary_${new Date().toISOString().slice(0, 10)}.csv`;
        } else {
            const headers = ['User ID', 'Timestamp', 'Tipe'];
            const rows = lastPulledData.map(log => {
                const dt = new Date(log.timestamp);
                const tsStr = isNaN(dt.getTime()) ? log.timestamp : dt.toISOString();
                return [log.userId, tsStr, log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang')].join(',');
            });
            csvContent = [headers.join(','), ...rows].join('\n');
            filename = `rawlog_${new Date().toISOString().slice(0, 10)}.csv`;
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast('Exporting to CSV...', 'success');
    } catch (err) {
        console.error('Export error:', err);
        showToast('Export failed: ' + err.message, 'error');
    }
}

export function downloadRawData() {
    if (!lastPulledData || lastPulledData.length === 0) {
        showToast('No data to download', 'warning');
        return;
    }

    try {
        const jsonContent = JSON.stringify(lastPulledData, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.setAttribute('href', url);
        link.setAttribute('download', `fingerprint_raw_${timestamp}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast('Downloading Raw JSON...', 'success');
    } catch (err) {
        console.error('Download error:', err);
        showToast('Download failed', 'error');
    }
}

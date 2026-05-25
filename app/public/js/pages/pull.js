import { showToast, showConfirm } from '../utils.js';

// Pull Page State
export let lastPulledData = [];
export let pullPageState = { 
    page: 1, 
    limit: 25, // Matched with default in HTML
    total: 0
};
export let _currentPullView = 'presensi'; // 'presensi' or 'raw'

export async function refreshPull() {
    try {
        const res = await fetch('/api/devices');
        const data = await res.json();
        const select = document.getElementById('pull-device-select');
        if (!select) return;

        const devices = data.data?.list || data.data || [];
        const currentId = select.value;
        
        select.innerHTML = '<option value="">-- Select Device --</option>' + 
            devices.map(d => `<option value="${d.id}" ${d.id == currentId ? 'selected' : ''}>${d.name || d.ip} (${d.sn})</option>`).join('');
    } catch (err) {
        console.error('Failed to load devices for pull', err);
    }
}

/**
 * Main function for pulling data from device
 * @param {'preview'|'sync'} mode 
 */
export async function pullDataFromDevice(mode = 'preview') {
    const deviceId = document.getElementById('pull-device-select').value;
    if (!deviceId) return showToast('Please select a device', 'warning');

    const btnPreview = document.getElementById('btn-pull-preview');
    const btnSync = document.getElementById('btn-pull-data');
    const progressWrap = document.getElementById('pull-progress-wrap');
    const progressBar = document.getElementById('pull-progress-bar');
    const progressPct = document.getElementById('pull-progress-pct');
    const progressLabel = document.getElementById('pull-progress-label');
    const resultsContainer = document.getElementById('pull-results-container');
    const statusDiv = document.getElementById('pull-status');

    const btnPreviewOrig = btnPreview.innerHTML;
    const btnSyncOrig = btnSync.innerHTML;

    // Reset UI
    if (btnPreview) {
        btnPreview.disabled = true;
        if (mode === 'preview') btnPreview.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Previewing...';
    }
    if (btnSync) {
        btnSync.disabled = true;
        if (mode === 'sync') btnSync.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }
    
    if (progressWrap) progressWrap.style.display = 'block';
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (statusDiv) statusDiv.style.display = 'none';

    updateProgress(5, 'Initializing connection...');
    setStage('stage-connect');

    // Smooth Progress Simulation
    let currentPct = 5;
    const progressInterval = setInterval(() => {
        if (currentPct < 90) {
            currentPct += Math.random() * 2;
            let label = 'Connecting...';
            if (currentPct > 20) {
                label = 'Fetching logs from device...';
                setStage('stage-fetch');
            }
            if (currentPct > 60) {
                label = 'Processing records...';
                setStage('stage-process');
            }
            updateProgress(Math.floor(currentPct), label);
        }
    }, 200);

    try {
        const res = await fetch('/api/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: parseInt(deviceId),
                preview: mode === 'preview',
                clearAfterSync: false
            })
        });
        const data = await res.json();

        clearInterval(progressInterval);

        if (res.ok && data.status === 'success') {
            updateProgress(100, mode === 'sync' ? 'Sync completed!' : 'Preview ready!');
            setStage('stage-done');

            lastPulledData = data.data?.list || data.data?.logs || [];
            
            if (mode === 'sync') {
                showToast(data.message || `Successfully synced ${lastPulledData.length} logs`, 'success');
                statusDiv.style.display = 'block';
                statusDiv.innerHTML = `
                    <div style="color: var(--success); font-weight: 600; margin-bottom: 0.5rem;">
                        <i class="fas fa-check-circle"></i> ${data.message || 'Sync Completed'}
                    </div>
                    <div style="font-size: 0.8rem; opacity: 0.8;">
                        Total logs retrieved: ${lastPulledData.length}
                    </div>
                `;
            } else {
                showToast(`Successfully pulled ${lastPulledData.length} logs for preview`, 'success');
                if (lastPulledData.length > 0) {
                    resultsContainer.style.display = 'block';
                    // Show export buttons with proper layout
                    const btnExport = document.getElementById('btn-export-pull');
                    const btnJson = document.getElementById('btn-download-raw');
                    if (btnExport) {
                        btnExport.style.display = 'inline-flex';
                        btnExport.style.alignItems = 'center';
                        btnExport.style.gap = '0.5rem';
                        btnExport.style.justifyContent = 'center';
                    }
                    if (btnJson) {
                        btnJson.style.display = 'inline-flex';
                        btnJson.style.alignItems = 'center';
                        btnJson.style.gap = '0.5rem';
                        btnJson.style.justifyContent = 'center';
                    }

                    pullPageState.page = 1;
                    renderPullResults();
                } else {
                    statusDiv.style.display = 'block';
                    statusDiv.innerHTML = '<i class="fas fa-info-circle"></i> No new logs found on device.';
                }
            }
        } else {
            throw new Error(data.message || 'Failed to pull data');
        }
    } catch (err) {
        clearInterval(progressInterval);
        showToast(err.message || 'Network error during pull', 'error');
        updateProgress(0, 'Failed');
        resetStages();
    } finally {
        if (btnPreview) {
            btnPreview.disabled = false;
            btnPreview.innerHTML = btnPreviewOrig;
        }
        if (btnSync) {
            btnSync.disabled = false;
            btnSync.innerHTML = btnSyncOrig;
        }
        // Hide progress after a delay if success
        setTimeout(() => {
            if (progressBar && progressBar.style.width === '100%') {
                if (progressWrap) progressWrap.style.display = 'none';
            }
        }, 2500);
    }

    function updateProgress(pct, label) {
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressPct) progressPct.innerText = pct + '%';
        if (progressLabel) progressLabel.innerText = label;
    }

    function setStage(stageId) {
        resetStages();
        const el = document.getElementById(stageId);
        if (el) {
            el.style.background = 'rgba(36, 97, 150, 0.2)';
            el.style.borderColor = 'var(--primary)';
            el.style.color = 'var(--text)';
        }
    }

    function resetStages() {
        ['stage-connect', 'stage-fetch', 'stage-process', 'stage-done'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.style.background = 'rgba(255,255,255,0.04)';
                el.style.borderColor = 'var(--glass-border)';
                el.style.color = 'var(--text-muted)';
            }
        });
    }
}

export function renderPullResults() {
    const logs = lastPulledData;
    if (!logs) return;

    const isPresensi = _currentPullView === 'presensi';
    
    // Update pagination info
    const total = logs.length;
    pullPageState.total = total;
    
    const totalPages = Math.ceil(total / pullPageState.limit);
    const info = document.getElementById('pull-results-info');
    const start = (pullPageState.page - 1) * pullPageState.limit + 1;
    const end = Math.min(pullPageState.page * pullPageState.limit, total);
    
    if (info) info.innerText = `Showing ${total ? start : 0}-${end} of ${total}`;
    
    const prevBtn = document.getElementById('pull-prev-btn');
    const nextBtn = document.getElementById('pull-next-btn');
    if (prevBtn) prevBtn.disabled = pullPageState.page <= 1;
    if (nextBtn) nextBtn.disabled = pullPageState.page >= totalPages;

    // Render pagination numbers
    renderPullPaginationNumbers(totalPages);

    const startIdx = (pullPageState.page - 1) * pullPageState.limit;
    const paged = logs.slice(startIdx, startIdx + pullPageState.limit);

    if (isPresensi) {
        const body = document.getElementById('pull-presensi-body');
        if (body) {
            body.innerHTML = paged.map(log => {
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
            }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No data found</td></tr>';
        }
    } else {
        const body = document.getElementById('pull-raw-body');
        if (body) {
            body.innerHTML = paged.map(log => {
                const dt = new Date(log.timestamp);
                const dateStr = isNaN(dt.getTime()) ? log.timestamp : dt.toLocaleString('id-ID');
                const absensi = log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang');
                return `<tr>
                    <td><strong>${log.userId}</strong></td>
                    <td>${dateStr}</td>
                    <td><span class="badge">${absensi}</span></td>
                </tr>`;
            }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);">No data found</td></tr>';
        }
    }
}

function renderPullPaginationNumbers(totalPages) {
    const container = document.getElementById('pull-pagination-numbers');
    if (!container) return;
    container.innerHTML = '';
    
    if (totalPages <= 1) return;

    const maxLinks = 5;
    let start = Math.max(1, pullPageState.page - 2);
    let end = Math.min(totalPages, start + maxLinks - 1);
    if (end - start < maxLinks - 1) start = Math.max(1, end - maxLinks + 1);

    for (let i = start; i <= end; i++) {
        const btn = document.createElement('div');
        btn.className = `page-link ${i === pullPageState.page ? 'active' : ''}`;
        btn.innerText = i;
        btn.onclick = () => {
            pullPageState.page = i;
            renderPullResults();
        };
        container.appendChild(btn);
    }
}

export function switchPullView(view) {
    _currentPullView = view;
    
    const tabPresensi = document.getElementById('tab-presensi');
    const tabRaw = document.getElementById('tab-raw');
    
    if (view === 'presensi') {
        if (tabPresensi) {
            tabPresensi.style.background = 'var(--primary)';
            tabPresensi.style.color = 'white';
        }
        if (tabRaw) {
            tabRaw.style.background = 'transparent';
            tabRaw.style.color = 'var(--text-muted)';
        }
        document.getElementById('view-presensi').style.display = 'block';
        document.getElementById('view-raw').style.display = 'none';
    } else {
        if (tabPresensi) {
            tabPresensi.style.background = 'transparent';
            tabPresensi.style.color = 'var(--text-muted)';
        }
        if (tabRaw) {
            tabRaw.style.background = 'var(--primary)';
            tabRaw.style.color = 'white';
        }
        document.getElementById('view-presensi').style.display = 'none';
        document.getElementById('view-raw').style.display = 'block';
    }
    
    pullPageState.page = 1;
    renderPullResults();
}

export function updatePullPageSize(val) {
    pullPageState.limit = parseInt(val);
    pullPageState.page = 1;
    renderPullResults();
}

export function nextPullPage() {
    const totalPages = Math.ceil(pullPageState.total / pullPageState.limit);
    if (pullPageState.page < totalPages) {
        pullPageState.page++;
        renderPullResults();
    }
}

export function prevPullPage() {
    if (pullPageState.page > 1) {
        pullPageState.page--;
        renderPullResults();
    }
}

export function exportPulledData() {
    if (!lastPulledData || lastPulledData.length === 0) {
        showToast('No data to export', 'warning');
        return;
    }
    // ... existing export logic ...
    // Note: SheetJS (XLSX) is already loaded in index.html, using CSV for simplicity or XLSX
    try {
        const worksheet = XLSX.utils.json_to_sheet(lastPulledData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Pulled Logs");
        XLSX.writeFile(workbook, `pulled_logs_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('Export successful', 'success');
    } catch (err) {
        showToast('Export failed', 'error');
    }
}

export function downloadRawData() {
    if (!lastPulledData || lastPulledData.length === 0) {
        showToast('No data to download', 'warning');
        return;
    }
    const blob = new Blob([JSON.stringify(lastPulledData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raw_pull_${new Date().getTime()}.json`;
    a.click();
    showToast('Download started', 'success');
}

import { showToast, toggleModal } from '../utils.js';

// Pull Employee Page State
export let lastPulledEmployeeData = [];
export let pullEmployeePageState = {
    page: 1,
    limit: 25,
    total: 0
};
export let _currentPullEmployeeView = 'list';

// Storage key for persisting pull employee state across refreshes
const STORAGE_KEY = 'pull_employee_state';

function saveStateToStorage() {
    try {
        const state = {
            deviceId: document.getElementById('pull-employee-device-select')?.value || '',
            data: lastPulledEmployeeData,
            view: _currentPullEmployeeView
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        // Ignore storage errors
    }
}

function restoreStateFromStorage() {
    try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
            const state = JSON.parse(saved);
            if (state.data && state.data.length > 0) {
                lastPulledEmployeeData = state.data;
                _currentPullEmployeeView = state.view || 'list';
                return state;
            }
        }
    } catch (e) {
        // Ignore storage errors
    }
    return null;
}

function clearSavedState() {
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        // Ignore storage errors
    }
}

export async function refreshPullEmployee() {
    try {
        const res = await fetch('/api/devices');
        const data = await res.json();
        const select = document.getElementById('pull-employee-device-select');
        if (!select) return;

        const devices = data.data?.list || data.data || [];

        // Check if we have saved state to restore
        const savedState = restoreStateFromStorage();
        const savedDeviceId = savedState?.deviceId || '';

        select.innerHTML = '<option value="">-- Select Device --</option>' +
            devices.map(d => `<option value="${d.id}" ${d.id == savedDeviceId ? 'selected' : ''}>${d.name || d.ip} (${d.sn})</option>`).join('');

        // If we restored data from storage, re-render the results
        if (savedState && savedState.data && savedState.data.length > 0) {
            renderPullEmployeeResultsAfterRefresh();
        }

        // Listen for device select changes to save to storage
        select.onchange = function () {
            saveStateToStorage();
        };
    } catch (err) {
        console.error('Failed to load devices for pull employee', err);
    }
}

function renderPullEmployeeResultsAfterRefresh() {
    const resultsContainer = document.getElementById('pull-employee-results-container');
    const statusDiv = document.getElementById('pull-employee-status');
    const btnExport = document.getElementById('btn-export-pull-employee');
    const btnJson = document.getElementById('btn-download-raw-employee');

    if (resultsContainer) resultsContainer.style.display = 'block';
    if (statusDiv) statusDiv.style.display = 'none';

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

    // Restore the active tab
    switchPullEmployeeView(_currentPullEmployeeView);

    pullEmployeePageState.page = 1;
    renderPullEmployeeResults();
}

// Show sync direction modal using the app's standard modal
export function showSyncModal() {
    const deviceId = document.getElementById('pull-employee-device-select').value;
    if (!deviceId) return showToast('Please select a device', 'warning');

    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');
    const saveBtn = document.getElementById('modal-save-btn');

    if (!modalTitle || !modalContent) return;

    modalTitle.innerHTML = '<i class="fas fa-sync-alt" style="margin-right: 0.5rem; color: var(--primary);"></i> Choose Sync Direction';

    // Get the sync modal content template and clone it
    const syncContent = document.getElementById('sync-modal-content');
    if (syncContent) {
        modalContent.innerHTML = syncContent.innerHTML;
    }

    // Hide the save button since we use the option buttons directly
    if (saveBtn) saveBtn.style.display = 'none';

    toggleModal(true);
}

export function closeSyncModal() {
    toggleModal(false);
}

/**
 * Main function for pulling employee data from device
 * @param {'preview'|'sync'} mode 
 * @param {'device-to-server'|'server-to-device'} syncMode 
 */
export async function pullEmployeeDataFromDevice(mode = 'preview', syncMode = 'device-to-server') {
    const deviceId = document.getElementById('pull-employee-device-select').value;
    if (!deviceId) return showToast('Please select a device', 'warning');

    // Close sync modal if open
    closeSyncModal();

    const btnPreview = document.getElementById('btn-pull-employee-preview');
    const btnSync = document.getElementById('btn-pull-employee-sync');
    const progressWrap = document.getElementById('pull-employee-progress-wrap');
    const progressBar = document.getElementById('pull-employee-progress-bar');
    const progressPct = document.getElementById('pull-employee-progress-pct');
    const progressLabel = document.getElementById('pull-employee-progress-label');
    const resultsContainer = document.getElementById('pull-employee-results-container');
    const statusDiv = document.getElementById('pull-employee-status');

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
    setStage('emp-stage-connect');

    // Smooth Progress Simulation
    let currentPct = 5;
    const progressInterval = setInterval(() => {
        if (currentPct < 90) {
            currentPct += Math.random() * 2;
            let label = 'Connecting...';
            if (currentPct > 20) {
                label = 'Fetching users from device...';
                setStage('emp-stage-fetch');
            }
            if (currentPct > 60) {
                label = 'Processing records...';
                setStage('emp-stage-process');
            }
            updateProgress(Math.floor(currentPct), label);
        }
    }, 200);

    try {
        const res = await fetch('/api/pull-employee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: parseInt(deviceId),
                preview: mode === 'preview',
                syncMode: mode === 'sync' ? syncMode : undefined
            })
        });
        const data = await res.json();

        clearInterval(progressInterval);

        if (res.ok && data.status === 'success') {
            updateProgress(100, mode === 'sync' ? 'Sync completed!' : 'Preview ready!');
            setStage('emp-stage-done');

            lastPulledEmployeeData = data.data?.list || data.data?.users || [];

            // Save state to storage for persistence across refreshes
            if (mode === 'preview' && lastPulledEmployeeData.length > 0) {
                saveStateToStorage();
            } else if (mode === 'sync') {
                clearSavedState();
            }

            if (mode === 'sync') {
                const syncLabel = syncMode === 'device-to-server' ? 'Device → Server' : 'Server → Device';
                showToast(data.message || `Successfully synced`, 'success');
                statusDiv.style.display = 'block';
                const skipped = data.data?.skipped || 0;
                statusDiv.innerHTML = `
                    <div style="color: var(--success); font-weight: 600; margin-bottom: 0.5rem;">
                        <i class="fas fa-check-circle"></i> ${data.message || 'Sync Completed'}
                    </div>
                    <div style="font-size: 0.8rem; opacity: 0.8;">
                        <i class="fas fa-exchange-alt"></i> Direction: ${syncLabel}<br>
                        Total employees: ${data.data?.total || 0}<br>
                        ${skipped > 0 ? `<span style="color: var(--text-muted);">Skipped (unchanged): ${skipped}</span>` : ''}
                    </div>
                `;
            } else {
                showToast(`Successfully pulled ${lastPulledEmployeeData.length} users for preview`, 'success');
                if (lastPulledEmployeeData.length > 0) {
                    resultsContainer.style.display = 'block';
                    // Show export buttons
                    const btnExport = document.getElementById('btn-export-pull-employee');
                    const btnJson = document.getElementById('btn-download-raw-employee');
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

                    pullEmployeePageState.page = 1;
                    renderPullEmployeeResults();
                } else {
                    statusDiv.style.display = 'block';
                    statusDiv.innerHTML = '<i class="fas fa-info-circle"></i> No users found on device.';
                }
            }
        } else {
            throw new Error(data.message || 'Failed to pull employee data');
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
        ['emp-stage-connect', 'emp-stage-fetch', 'emp-stage-process', 'emp-stage-done'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.style.background = 'rgba(255,255,255,0.04)';
                el.style.borderColor = 'var(--glass-border)';
                el.style.color = 'var(--text-muted)';
            }
        });
    }
}

export function renderPullEmployeeResults() {
    const users = lastPulledEmployeeData;
    if (!users) return;

    // Sort users by userId numerically (1,2,3,4... not 1,10,100,101)
    const sorted = [...users].sort((a, b) => {
        const numA = parseInt(a.userId) || 0;
        const numB = parseInt(b.userId) || 0;
        return numA - numB;
    });

    // Update pagination info
    const total = sorted.length;
    pullEmployeePageState.total = total;

    const totalPages = Math.ceil(total / pullEmployeePageState.limit);
    const info = document.getElementById('pull-employee-results-info');
    const start = (pullEmployeePageState.page - 1) * pullEmployeePageState.limit + 1;
    const end = Math.min(pullEmployeePageState.page * pullEmployeePageState.limit, total);

    if (info) info.innerText = `Showing ${total ? start : 0}-${end} of ${total}`;

    const prevBtn = document.getElementById('pull-employee-prev-btn');
    const nextBtn = document.getElementById('pull-employee-next-btn');
    if (prevBtn) prevBtn.disabled = pullEmployeePageState.page <= 1;
    if (nextBtn) nextBtn.disabled = pullEmployeePageState.page >= totalPages;

    // Render pagination numbers
    renderPullEmployeePaginationNumbers(totalPages);

    const startIdx = (pullEmployeePageState.page - 1) * pullEmployeePageState.limit;
    const paged = sorted.slice(startIdx, startIdx + pullEmployeePageState.limit);

    const body = document.getElementById('pull-employee-list-body');
    if (body) {
        body.innerHTML = paged.map(user => {
            const roleLabel = user.role == 14 ? 'Admin' : (user.role == 0 ? 'User' : `Role ${user.role}`);

            return `<tr>
                <td><strong>${user.userId}</strong></td>
                <td>${user.name}</td>
                <td><span class="badge" style="background: rgba(99,102,241,0.2); color: #818cf8;">${roleLabel}</span></td>
                <td>${user.fingerprintCount ?? user['10fingercount'] ?? 0}</td>
                <td>${user.faceCount || 0}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No data found</td></tr>';
    }
}

function renderPullEmployeePaginationNumbers(totalPages) {
    const container = document.getElementById('pull-employee-pagination-numbers');
    if (!container) return;
    container.innerHTML = '';

    if (totalPages <= 1) return;

    const maxLinks = 5;
    let start = Math.max(1, pullEmployeePageState.page - 2);
    let end = Math.min(totalPages, start + maxLinks - 1);
    if (end - start < maxLinks - 1) start = Math.max(1, end - maxLinks + 1);

    for (let i = start; i <= end; i++) {
        const btn = document.createElement('div');
        btn.className = `page-link ${i === pullEmployeePageState.page ? 'active' : ''}`;
        btn.innerText = i;
        btn.onclick = () => {
            pullEmployeePageState.page = i;
            renderPullEmployeeResults();
        };
        container.appendChild(btn);
    }
}

export function switchPullEmployeeView(view) {
    _currentPullEmployeeView = view;

    const tabList = document.getElementById('tab-emp-list');
    if (tabList) {
        tabList.style.background = 'var(--primary)';
        tabList.style.color = 'white';
    }

    document.getElementById('view-emp-list').style.display = 'block';

    pullEmployeePageState.page = 1;
    renderPullEmployeeResults();
}

export function updatePullEmployeePageSize(val) {
    pullEmployeePageState.limit = parseInt(val);
    pullEmployeePageState.page = 1;
    renderPullEmployeeResults();
}

export function nextPullEmployeePage() {
    const totalPages = Math.ceil(pullEmployeePageState.total / pullEmployeePageState.limit);
    if (pullEmployeePageState.page < totalPages) {
        pullEmployeePageState.page++;
        renderPullEmployeeResults();
    }
}

export function prevPullEmployeePage() {
    if (pullEmployeePageState.page > 1) {
        pullEmployeePageState.page--;
        renderPullEmployeeResults();
    }
}

export function exportPulledEmployeeData() {
    if (!lastPulledEmployeeData || lastPulledEmployeeData.length === 0) {
        showToast('No data to export', 'warning');
        return;
    }
    try {
        const exportData = lastPulledEmployeeData.map(u => ({
            'User ID': u.userId,
            'Name': u.name,
            'Fingerprint Count': u.fingerprintCount ?? u['10fingercount'] ?? 0,
            'Has Fingerprint': (u.fingerprintCount ?? u['10fingercount'] ?? 0) > 0 ? 'Yes' : 'No',
            'Card Number': u.cardno || 0,
            'Role': u.role ?? 0
        }));
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Pulled Employees");
        XLSX.writeFile(workbook, `pulled_employees_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('Export successful', 'success');
    } catch (err) {
        showToast('Export failed', 'error');
    }
}

export function downloadRawEmployeeData() {
    if (!lastPulledEmployeeData || lastPulledEmployeeData.length === 0) {
        showToast('No data to download', 'warning');
        return;
    }
    const blob = new Blob([JSON.stringify(lastPulledEmployeeData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raw_employees_${new Date().getTime()}.json`;
    a.click();
    showToast('Download started', 'success');
}

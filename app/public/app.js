// State management
let currentUser = null;
let currentPath = 'overview';

const paginationState = {
    overview: { page: 0, size: 10, total: 0 },
    employees: { page: 0, size: 25, total: 0 },
    logs: { page: 0, size: 25, total: 0 }
};

// Initial check
async function checkAuth() {
    try {
        const response = await fetch('/auth/me');
        if (response.ok) {
            const data = await response.json();
            currentUser = data.data.user;
            showDashboard();
        } else {
            showLogin();
        }
    } catch (err) {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('login-view').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    refreshOverview();
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    const error = document.getElementById('login-error');

    btn.disabled = true;
    btn.innerText = 'Signing in...';
    error.style.display = 'none';

    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (response.ok) {
            currentUser = data.data.user;
            showDashboard();
            showToast('Welcome back, ' + currentUser.username);
        } else {
            error.innerText = data.message || 'Login failed';
            error.style.display = 'block';
        }
    } catch (err) {
        error.innerText = 'Network error occurred';
        error.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerText = 'Sign In';
    }
}

async function logout() {
    await fetch('/auth/logout', { method: 'POST' });
    showLogin();
}

function showPage(pageId) {
    if (pageId === 'settings') {
        openSettingsAuth();
        return;
    }

    currentPath = pageId;

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        // Simple heuristic to find the nav item
        if (item.getAttribute('onclick')?.includes(`'${pageId}'`)) {
            item.classList.add('active');
        }
    });

    // Update pages
    document.querySelectorAll('.page').forEach(page => {
        page.style.display = 'none';
    });
    const activePage = document.getElementById('page-' + pageId);
    if (activePage) activePage.style.display = 'block';

    // Fetch data for the page
    if (pageId === 'overview') refreshOverview();
    if (pageId === 'devices') refreshDevices();
    if (pageId === 'employees') refreshEmployees();
    if (pageId === 'logs') refreshLogs();
    if (pageId === 'settings') loadSettings();

    // Close mobile sidebar if open
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

// Pagination Helpers
function updatePageSize(section, size) {
    paginationState[section].size = parseInt(size);
    paginationState[section].page = 0; // Reset to first page
    if (section === 'overview') refreshOverview();
    if (section === 'employees') refreshEmployees();
    if (section === 'logs') refreshLogs();
}

function nextPage(section) {
    const s = paginationState[section];
    if ((s.page + 1) * s.size < s.total) {
        s.page++;
        if (section === 'overview') refreshOverview();
        if (section === 'employees') refreshEmployees();
        if (section === 'logs') refreshLogs();
    }
}

function prevPage(section) {
    const s = paginationState[section];
    if (s.page > 0) {
        s.page--;
        if (section === 'overview') refreshOverview();
        if (section === 'employees') refreshEmployees();
        if (section === 'logs') refreshLogs();
    }
}

function updatePaginationUI(section) {
    const s = paginationState[section];
    const info = document.getElementById(`${section}-info`);
    const paginationNumbers = document.getElementById(`${section}-pagination-numbers`);
    const prevBtn = document.getElementById(`${section}-prev-btn`);
    const nextBtn = document.getElementById(`${section}-next-btn`);

    if (info) {
        const start = s.total === 0 ? 0 : (s.page * s.size) + 1;
        const end = Math.min((s.page + 1) * s.size, s.total);
        info.innerText = `Showing ${start} to ${end} of ${s.total} entries`;
    }

    if (paginationNumbers) {
        const totalPages = Math.ceil(s.total / s.size) || 1;
        let html = '';

        const isMobile = window.innerWidth < 640;
        const maxLinks = isMobile ? 3 : 5;
        const offset = Math.floor(maxLinks / 2);

        // Render pages around current page
        let startPage = Math.max(0, s.page - offset);
        let endPage = Math.min(totalPages - 1, startPage + (maxLinks - 1));

        if (endPage - startPage < (maxLinks - 1)) {
            startPage = Math.max(0, endPage - (maxLinks - 1));
        }

        for (let i = startPage; i <= endPage; i++) {
            html += `<div class="page-link ${i === s.page ? 'active' : ''}" onclick="goToPage('${section}', ${i})">${i + 1}</div>`;
        }
        paginationNumbers.innerHTML = html;
    }

    if (prevBtn) prevBtn.disabled = s.page === 0;
    if (nextBtn) nextBtn.disabled = (s.page + 1) * s.size >= s.total;
}

function goToPage(section, page) {
    paginationState[section].page = page;
    if (section === 'overview') refreshOverview();
    if (section === 'devices') refreshDevices();
    if (section === 'employees') refreshEmployees();
    if (section === 'logs') refreshLogs();
}

// Pages Logic
async function refreshOverview() {
    try {
        const s = paginationState.overview;
        const [devicesRes, empRes, logsRes] = await Promise.all([
            fetch('/api/devices'),
            fetch('/api/employees?limit=1'), // Just to get total
            fetch(`/api/logs?limit=${s.size}&offset=${s.page * s.size}`)
        ]);

        const devicesData = await devicesRes.json();
        const employeesData = await empRes.json();
        const logsData = await logsRes.json();

        document.getElementById('stat-devices').innerText = devicesData.data?.length || 0;
        document.getElementById('stat-employees').innerText = employeesData.data?.total || 0;

        // Logs stats (today)
        const today = new Date().toISOString().split('T')[0];
        // Note: logsData might only have a page. Better to have a separate total-today endpoint, 
        // but for now let's just use what we have or show "-"
        document.getElementById('stat-logs').innerText = "...";
        fetch(`/api/logs?from=${today}`).then(r => r.json()).then(d => {
            document.getElementById('stat-logs').innerText = d.data?.total || 0;
        });

        s.total = logsData.data?.total || 0;
        renderRecentLogs(logsData.data?.logs || []);
        updatePaginationUI('overview');
    } catch (err) {
        console.error('Failed to refresh overview', err);
    }
}

function renderRecentLogs(logs) {
    const body = document.getElementById('recent-logs-body');
    body.innerHTML = logs.map(log => {
        const dt = new Date(log.timestamp);
        const dateStr = `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}/${dt.getUTCFullYear()}`;
        const timeStr = dt.toISOString().split('T')[1].substring(0, 8); // hh:mm:ss

        return `
            <tr>
                <td>${dateStr} <small style="opacity:0.6">${timeStr}</small></td>
                <td>${log.nama || log.user_id}</td>
                <td><span class="badge ${log.type == 0 ? 'badge-success' : 'badge-warning'}">${log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang')}</span></td>
                <td>${log.device_name || log.device_sn || '-'}</td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="4" style="text-align: center;">No logs found</td></tr>';
}

async function refreshDevices() {
    const res = await fetch('/api/devices');
    const data = await res.json();
    const body = document.getElementById('devices-body');
    body.innerHTML = (data.data || []).map(dev => `
        <tr>
            <td><span class="badge ${dev.is_active ? 'badge-success' : 'badge-error'}">${dev.is_active ? 'Online' : 'Offline'}</span></td>
            <td>${dev.name || 'Unnamed'}</td>
            <td>${dev.ip}</td>
            <td>${dev.sn || '-'}</td>
            <td><span class="badge">${dev.sync_mode || 'HYBRID'}</span></td>
            <td>${dev.last_sync ? new Date(dev.last_sync).toLocaleString() : 'Never'}</td>
            <td>
                <button class="icon-btn" onclick="syncDevice('${dev.sn}')" title="Sync Now"><i class="fas fa-sync"></i></button>
                <button class="icon-btn" onclick="openEditDevice(${dev.id}, '${dev.name || ''}')" title="Edit Name"><i class="fas fa-edit"></i></button>
                <button class="icon-btn" onclick="deleteDevice(${dev.id})" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

async function refreshEmployees() {
    const s = paginationState.employees;
    const search = document.getElementById('employee-search').value;

    let url = `/api/employees?limit=${s.size}&offset=${s.page * s.size}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const res = await fetch(url);
    const data = await res.json();

    s.total = data.data?.total || 0;
    const body = document.getElementById('employees-body');
    body.innerHTML = (data.data?.list || []).map(emp => `
        <tr>
            <td>${emp.user_id}</td>
            <td>${emp.nik || '-'}</td>
            <td>${emp.nama || 'Unnamed'}</td>
            <td>${emp.jabatan || '-'}</td>
            <td>${emp.department || '-'}</td>
            <td>
                <button class="icon-btn" onclick="editEmployee('${emp.id}')"><i class="fas fa-edit"></i></button>
                <button class="icon-btn" onclick="deleteEmployee('${emp.id}')"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="6" style="text-align: center;">No employees found</td></tr>';

    updatePaginationUI('employees');
}

let empSearchTimer;
function handleEmployeeSearch(val) {
    clearTimeout(empSearchTimer);
    empSearchTimer = setTimeout(() => {
        if (val.length >= 3 || val.length === 0) {
            paginationState.employees.page = 0;
            refreshEmployees();
        }
    }, 600);
}

async function editEmployee(id) {
    const res = await fetch('/api/employees/' + id);
    const { data: emp } = await res.json();

    document.getElementById('modal-title').innerText = 'Edit Employee';
    document.getElementById('modal-content').innerHTML = `
        <div class="form-group">
            <label>User ID (Fingerprint ID)</label>
            <input type="text" id="emp-uid" value="${emp.user_id}">
        </div>
        <div class="form-group">
            <label>Full Name</label>
            <input type="text" id="emp-name" value="${emp.nama || ''}">
        </div>
        <div class="form-group">
            <label>NIK</label>
            <input type="text" id="emp-nik" value="${emp.nik || ''}">
        </div>
        <div class="form-group">
            <label>Jabatan</label>
            <input type="text" id="emp-jabatan" value="${emp.jabatan || ''}">
        </div>
        <div class="form-group">
            <label>Department</label>
            <input type="text" id="emp-dept" value="${emp.department || ''}">
        </div>
    `;
    document.getElementById('modal-save-btn').onclick = () => saveEditEmployee(id);
    toggleModal(true);
}

async function saveEditEmployee(id) {
    const data = {
        user_id: document.getElementById('emp-uid').value,
        nama: document.getElementById('emp-name').value,
        nik: document.getElementById('emp-nik').value,
        jabatan: document.getElementById('emp-jabatan').value,
        department: document.getElementById('emp-dept').value
    };

    const res = await fetch('/api/employees/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    if (res.ok) {
        showToast('Employee updated');
        toggleModal(false);
        refreshEmployees();
    } else {
        showToast('Update failed', 'error');
    }
}

async function deleteEmployee(id) {
    if (!confirm('Are you sure you want to delete this employee?')) return;
    const res = await fetch('/api/employees/' + id, { method: 'DELETE' });
    if (res.ok) {
        showToast('Employee deleted');
        refreshEmployees();
    } else {
        showToast('Delete failed', 'error');
    }
}

// Attendance Logs Logic
let logSearchTimer;
function handleLogSearch(val) {
    clearTimeout(logSearchTimer);
    logSearchTimer = setTimeout(() => {
        // Trigger if 3+ chars or cleared
        if (val.length >= 3 || val.length === 0) {
            paginationState.logs.page = 0;
            refreshLogs();
        }
    }, 600);
}

function applyLogFilter() {
    paginationState.logs.page = 0;
    refreshLogs();
}

async function refreshLogs() {
    const s = paginationState.logs;
    const fromDate = document.getElementById('log-date-from').value;
    const toDate = document.getElementById('log-date-to').value;
    const search = document.getElementById('log-search').value;

    let url = `/api/logs?limit=${s.size}&offset=${s.page * s.size}`;
    if (fromDate) url += `&from=${fromDate}T00:00:00`;
    if (toDate) url += `&to=${toDate}T23:59:59`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const res = await fetch(url);
    const data = await res.json();

    s.total = data.data?.total || 0;
    const body = document.getElementById('logs-body');

    body.innerHTML = (data.data?.logs || []).map(log => {
        const dt = new Date(log.timestamp);
        // Use UTC methods to show exactly as stored (Raw Machine Time)
        const dateStr = `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}/${dt.getUTCFullYear()}`;
        const timeStr = dt.toISOString().split('T')[1].substring(0, 5); // 24h hh:mm
        const secondsStr = dt.toISOString().split('T')[1].substring(6, 8); // ss

        return `
            <tr>
                <td>${dateStr}</td>
                <td>
                    <strong style="color: var(--primary); font-size: 1.1rem;">${timeStr}</strong>
                    <small style="opacity: 0.5; font-size: 0.75rem;">:${secondsStr}</small>
                </td>
                <td>
                    <div style="font-weight: 600;">${log.nama || 'Unknown'}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">ID: ${log.user_id}</div>
                </td>
                <td>${log.nik || '-'}</td>
                <td style="font-size: 0.8125rem;">
                    <div>${log.department || '-'}</div>
                    <div style="opacity: 0.7;">${log.jabatan || '-'}</div>
                </td>
                <td><span class="badge ${log.type == 0 ? 'badge-success' : 'badge-warning'}">${log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang')}</span></td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="6" style="text-align: center;">No logs found</td></tr>';

    updatePaginationUI('logs');
}

function showExportMenu() {
    toggleModal(true);
    document.getElementById('modal-title').innerText = 'Export Attendance Logs';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 2rem;">
            <i class="fas fa-file-excel" style="font-size: 3.5rem; color: var(--secondary); margin-bottom: 1rem;"></i>
            <p style="color: var(--text-muted);">Select the time range for your Excel export.</p>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            <button class="btn-primary" style="background: var(--primary);" onclick="performExport('all')">
                <i class="fas fa-globe"></i> Export Data (Based on Current Filters)
            </button>
            <button class="btn-primary" style="background: #4a5568;" onclick="performExport('today')">
                <i class="fas fa-calendar-day"></i> Export Today Only
            </button>
            <button class="btn-primary" style="background: #2d3748;" onclick="performExport('3days')">
                <i class="fas fa-calendar-week"></i> Export Last 3 Days
            </button>
            <button class="btn-primary" style="background: #1a202c;" onclick="performExport('all_absolute')">
                <i class="fas fa-file-invoice"></i> Export All (Ignored Filters)
            </button>
        </div>
    `;

    // Hide default save button
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.style.display = 'none';
}

async function performExport(range) {
    try {
        let fromDate = '';
        let toDate = '';
        let search = document.getElementById('log-search').value;

        const today = new Date().toISOString().split('T')[0];

        if (range === 'today') {
            fromDate = today;
            toDate = today;
        } else if (range === '3days') {
            const now = new Date();
            const last3 = new Date();
            last3.setDate(last3.getDate() - 3);

            fromDate = last3.toISOString(); // From 3 days ago
            toDate = now.toISOString();     // Until now (seconds included)
            search = ''; // No filters
        } else if (range === 'all_absolute') {
            fromDate = '';
            toDate = '';
            search = '';
        } else {
            // Use current UI filters (range === 'all')
            fromDate = document.getElementById('log-date-from').value;
            toDate = document.getElementById('log-date-to').value;
        }

        toggleModal(false);
        showToast('Preparing export data...');

        let url = `/api/logs?limit=50000`;

        // Handle ISO from/to for 3days range
        if (range === '3days') {
            url += `&from=${fromDate}&to=${toDate}`;
        } else {
            if (fromDate) url += `&from=${fromDate}T00:00:00`;
            if (toDate) url += `&to=${toDate}T23:59:59`;
        }

        if (search) url += `&search=${encodeURIComponent(search)}`;

        const res = await fetch(url);
        const data = await res.json();
        const logs = data.data?.logs || [];

        const exportData = logs.map(log => {
            const dt = new Date(log.timestamp);
            const timeFull = dt.toISOString().split('T')[1].substring(0, 8); // hh:mm:ss
            return {
                Date: `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}/${dt.getUTCFullYear()}`,
                Time: timeFull,
                'User ID': log.user_id,
                Name: log.nama,
                NIK: log.nik,
                Department: log.department,
                Jabatan: log.jabatan,
                Status: log.absensi,
                Device: log.device_name
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance Logs");

        const filename = `attendance_${range}_${today}.xlsx`;
        XLSX.writeFile(workbook, filename);
        showToast('Export successful', 'success');
    } catch (err) {
        showToast('Export failed', 'error');
    }
}

// Settings Logic
async function loadSettings() {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.status === 'success') {
        document.getElementById('setting-api-key').value = data.data.api_key || '';
        document.getElementById('setting-cleanup-days').value = data.data.cleanup_age_days || 30;
    }
}

async function saveSettings() {
    const apiKey = document.getElementById('setting-api-key').value;
    const cleanupDays = document.getElementById('setting-cleanup-days').value;

    showToast('Saving settings...');
    try {
        const res = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: apiKey,
                cleanup_age_days: parseInt(cleanupDays)
            })
        });

        if (res.ok) {
            showToast('Settings saved successfully', 'success');
        } else {
            showToast('Failed to save settings', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

async function updateAccount() {
    const username = document.getElementById('profile-username').value;
    const password = document.getElementById('profile-password').value;

    if (!username && !password) {
        return showToast('Please fill at least one field', 'warning');
    }

    try {
        const res = await fetch('/auth/account', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (res.ok) {
            showToast('Account updated successfully', 'success');
            document.getElementById('profile-username').value = '';
            document.getElementById('profile-password').value = '';
            // Refresh info if needed
            checkAuth();
        } else {
            const data = await res.json();
            showToast(data.message || 'Update failed', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

// Actions
async function syncAll() {
    showToast('Starting sync for all devices...');
    const res = await fetch('/api/sync/all', { method: 'POST' });
    if (res.ok) {
        showToast('Sync completed successfully!', 'success');
        refreshOverview();
    } else {
        showToast('Sync failed', 'error');
    }
}

async function syncDevice(sn) {
    showToast('Syncing device ' + sn + '...');
    const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sn })
    });
    if (res.ok) {
        showToast('Device ' + sn + ' synced!', 'success');
        refreshDevices();
    } else {
        showToast('Sync failed for ' + sn, 'error');
    }
}

async function deleteDevice(id) {
    if (!confirm('Are you sure you want to delete this device?')) return;
    const res = await fetch('/api/devices/' + id, { method: 'DELETE' });
    if (res.ok) {
        showToast('Device deleted');
        refreshDevices();
    }
}

async function pullAllEmployees() {
    showToast('Pulling employees from all devices...');
    const res = await fetch('/api/sync/all', { method: 'POST' });
    if (res.ok) {
        showToast('Employees synchronized');
        refreshEmployees();
    }
}

async function exportEmployees() {
    try {
        const res = await fetch('/api/employees?limit=5000');
        const data = await res.json();
        const employees = data.data?.list || [];

        // Buat sheet dari data JSON
        const worksheet = XLSX.utils.json_to_sheet(employees);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Employees");

        // Export file
        XLSX.writeFile(workbook, `employees_export_${new Date().toISOString().split('T')[0]}.xlsx`);
        showToast('Export successful');
    } catch (err) {
        showToast('Export failed', 'error');
    }
}

function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const employees = XLSX.utils.sheet_to_json(worksheet);

            if (!Array.isArray(employees)) throw new Error('Invalid format');
            showToast(`Importing ${employees.length} employees...`);
            const res = await fetch('/api/employees/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employees })
            });
            if (res.ok) {
                showToast(`Successfully imported employees`, 'success');
                refreshEmployees();
            } else {
                showToast('Import failed', 'error');
            }
        } catch (err) {
            showToast('Invalid Excel file', 'error');
        }
        event.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}

// Modal Handlers
function openAddDevice() {
    document.getElementById('modal-title').innerText = 'Add New Device';
    document.getElementById('modal-content').innerHTML = `
        <div class="form-group">
            <label>Device Name</label>
            <input type="text" id="dev-name" placeholder="Front Office">
        </div>
        <div class="form-group">
            <label>IP Address</label>
            <input type="text" id="dev-ip" placeholder="192.168.1.10">
        </div>
        <div class="form-group">
            <label>Port</label>
            <input type="number" id="dev-port" value="4370">
        </div>
        <div class="form-group">
            <label>Serial Number (Optional)</label>
            <input type="text" id="dev-sn" placeholder="Leave empty for auto-detect">
        </div>
    `;
    document.getElementById('modal-save-btn').onclick = saveNewDevice;
    toggleModal(true);
}

function openEditDevice(id, currentName) {
    document.getElementById('modal-title').innerText = 'Edit Device Name';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 1.5rem;">
            <i class="fas fa-edit" style="font-size: 3rem; color: var(--primary); margin-bottom: 1rem;"></i>
            <p style="color: var(--text-muted);">Please enter a new name for this device.</p>
        </div>
        <div class="form-group">
            <label>Device Name</label>
            <input type="text" id="edit-dev-name" value="${currentName}" placeholder="e.g. Office 1">
        </div>
    `;
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = 'Update Name';
    saveBtn.style.display = 'block';
    saveBtn.onclick = () => saveEditDevice(id);
    toggleModal(true);
}

async function saveEditDevice(id) {
    const name = document.getElementById('edit-dev-name').value;
    if (!name) return showToast('Name is required', 'warning');

    try {
        const res = await fetch(`/api/devices/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (res.ok) {
            showToast('Device name updated', 'success');
            toggleModal(false);
            refreshDevices();
        } else {
            showToast('Failed to update device', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

async function saveNewDevice() {
    const data = {
        name: document.getElementById('dev-name').value,
        ip: document.getElementById('dev-ip').value,
        port: parseInt(document.getElementById('dev-port').value),
        sn: document.getElementById('dev-sn').value || undefined
    };

    const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    if (res.ok) {
        showToast('Device added successfully');
        toggleModal(false);
        refreshDevices();
    } else {
        const err = await res.json();
        showToast(err.error || 'Failed to add device', 'error');
    }
}

function openAddEmployee() {
    document.getElementById('modal-title').innerText = 'Add New Employee';
    document.getElementById('modal-content').innerHTML = `
        <div class="form-group">
            <label>User ID (Fingerprint ID)</label>
            <input type="text" id="emp-uid" placeholder="101">
        </div>
        <div class="form-group">
            <label>Full Name</label>
            <input type="text" id="emp-name" placeholder="John Doe">
        </div>
        <div class="form-group">
            <label>NIK</label>
            <input type="text" id="emp-nik" placeholder="123456">
        </div>
        <div class="form-group">
            <label>Jabatan</label>
            <input type="text" id="emp-jabatan" placeholder="Staff IT">
        </div>
        <div class="form-group">
            <label>Department</label>
            <input type="text" id="emp-dept" placeholder="IT">
        </div>
    `;
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = 'Save Employee';
    saveBtn.onclick = saveNewEmployee;
    saveBtn.style.display = 'block';
    toggleModal(true);
}

async function saveNewEmployee() {
    const data = {
        user_id: document.getElementById('emp-uid').value,
        nama: document.getElementById('emp-name').value,
        nik: document.getElementById('emp-nik').value,
        jabatan: document.getElementById('emp-jabatan').value,
        department: document.getElementById('emp-dept').value
    };

    const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    if (res.ok) {
        showToast('Employee added');
        toggleModal(false);
        refreshEmployees();
    } else {
        showToast('Failed to add employee', 'error');
    }
}

// UI Helpers
function toggleModal(show) {
    const overlay = document.getElementById('modal-overlay');
    if (show) overlay.classList.add('active');
    else overlay.classList.remove('active');
}

function closeModal(e) {
    toggleModal(false);
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    msgEl.innerText = message;

    toast.style.borderColor = type === 'error' ? 'var(--error)' : (type === 'success' ? 'var(--success)' : 'var(--glass-border)');

    toast.classList.add('active');
    setTimeout(() => toast.classList.remove('active'), 3000);
}

// Settings Protection Modal
function openSettingsAuth() {
    toggleModal(true);
    document.getElementById('modal-title').innerText = 'Authorization Required';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 1.5rem;">
            <i class="fas fa-lock" style="font-size: 3.5rem; color: var(--warning); margin-bottom: 2rem;"></i>
            <p style="color: var(--text-muted); font-size: 0.95rem;">Please enter the master password to access system settings.</p>
        </div>
        <div class="form-group">
            <label>Master Password</label>
            <input type="password" id="settings-pass" placeholder="Enter password..." autofocus autocomplete="off">
        </div>
    `;

    // Configure Footer
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = 'Unlock Settings';
    saveBtn.style.display = 'block';
    saveBtn.onclick = verifySettingsPass;

    // Handle Enter key on input
    document.getElementById('settings-pass').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') verifySettingsPass();
    });

    setTimeout(() => document.getElementById('settings-pass')?.focus(), 150);
}

function verifySettingsPass() {
    const passInput = document.getElementById('settings-pass');
    if (passInput.value === 'Gsi651!@') {
        toggleModal(false);
        // Force show page logic
        const pageId = 'settings';
        currentPath = pageId;

        // Manual DOM updates similar to showPage
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('onclick')?.includes(`'${pageId}'`)) {
                item.classList.add('active');
            }
        });
        document.querySelectorAll('.page').forEach(page => {
            page.style.display = 'none';
        });
        const activePage = document.getElementById('page-' + pageId);
        if (activePage) activePage.style.display = 'block';
        loadSettings();

        showToast('Access Granted', 'success');
    } else {
        showToast('Invalid Password!', 'error');
        passInput.style.borderColor = 'var(--error)';
        passInput.value = '';
        passInput.focus();
    }
}

// Mobile Sidebar Toggle
function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('active');
    document.querySelector('.sidebar-overlay').classList.toggle('active');
}

// Initialize
checkAuth();
setInterval(checkAuth, 300000); // Check auth every 5 mins

// Handle window resize for pagination
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (currentPath === 'overview') updatePaginationUI('overview');
        if (currentPath === 'employees') updatePaginationUI('employees');
        if (currentPath === 'logs') updatePaginationUI('logs');
    }, 250);
});

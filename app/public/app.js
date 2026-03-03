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
    const pageNum = document.getElementById(`${section}-page-num`);
    const prevBtn = document.getElementById(`${section}-prev-btn`);
    const nextBtn = document.getElementById(`${section}-next-btn`);

    if (info) {
        const start = s.total === 0 ? 0 : (s.page * s.size) + 1;
        const end = Math.min((s.page + 1) * s.size, s.total);
        info.innerText = `Showing ${start} to ${end} of ${s.total} entries`;
    }

    if (pageNum) pageNum.innerText = s.page + 1;
    if (prevBtn) prevBtn.disabled = s.page === 0;
    if (nextBtn) nextBtn.disabled = (s.page + 1) * s.size >= s.total;
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
    body.innerHTML = logs.map(log => `
        <tr>
            <td>${new Date(log.timestamp).toLocaleString()}</td>
            <td>${log.user_id}</td>
            <td><span class="badge ${log.type == 0 ? 'badge-success' : 'badge-warning'}">${log.type == 0 ? 'CHECK-IN' : 'CHECK-OUT'}</span></td>
            <td>${log.device_sn || '-'}</td>
        </tr>
    `).join('') || '<tr><td colspan="4" style="text-align: center;">No logs found</td></tr>';
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
                <button class="icon-btn" onclick="deleteDevice(${dev.id})" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

async function refreshEmployees() {
    const s = paginationState.employees;
    const res = await fetch(`/api/employees?limit=${s.size}&offset=${s.page * s.size}`);
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

async function refreshLogs() {
    const s = paginationState.logs;
    const date = document.getElementById('log-date').value;
    const res = await fetch(`/api/logs?limit=${s.size}&offset=${s.page * s.size}${date ? '&date=' + date : ''}`);
    const data = await res.json();

    s.total = data.data?.total || 0;
    const body = document.getElementById('logs-body');
    body.innerHTML = (data.data?.logs || []).map(log => `
        <tr>
            <td>${new Date(log.timestamp).toLocaleString()}</td>
            <td>${log.user_id}</td>
            <td><span class="badge ${log.type == 0 ? 'badge-success' : 'badge-warning'}">${log.type == 0 ? 'CHECK-IN' : 'CHECK-OUT'}</span></td>
            <td>${log.device_sn || '-'}</td>
        </tr>
    `).join('') || '<tr><td colspan="4" style="text-align: center;">No logs found</td></tr>';

    updatePaginationUI('logs');
}

// Settings Logic
async function loadSettings() {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.status === 'success') {
        document.getElementById('setting-api-key').value = data.data.api_key || '';
        // Other settings...
    }
}

async function saveSettings() {
    const apiKey = document.getElementById('setting-api-key').value;
    const cleanupDays = document.getElementById('setting-cleanup-days').value;

    showToast('Saving settings...');
    // Impl logic...
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
    `;
    document.getElementById('modal-save-btn').onclick = saveNewEmployee;
    toggleModal(true);
}

async function saveNewEmployee() {
    const data = {
        user_id: document.getElementById('emp-uid').value,
        nama: document.getElementById('emp-name').value,
        nik: document.getElementById('emp-nik').value
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

// Initialize
checkAuth();
setInterval(checkAuth, 300000); // Check auth every 5 mins

// State management
let currentUser = null;
let currentPath = 'overview';

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
        if (item.onclick?.toString().includes(`'${pageId}'`)) {
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

// Pages Logic
async function refreshOverview() {
    try {
        const [devicesRes, empRes, logsRes] = await Promise.all([
            fetch('/api/devices'),
            fetch('/api/employees'),
            fetch('/api/logs?limit=10')
        ]);

        const devices = await devicesRes.json();
        const employees = await empRes.json();
        const logs = await logsRes.json();

        document.getElementById('stat-devices').innerText = devices.data?.length || 0;
        document.getElementById('stat-employees').innerText = employees.data?.total || 0;

        // Count today's logs
        const today = new Date().toISOString().split('T')[0];
        const todayLogs = (logs.data?.logs || []).filter(l => l.timestamp.startsWith(today));
        document.getElementById('stat-logs').innerText = todayLogs.length;

        renderRecentLogs(logs.data?.logs || []);
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
    const res = await fetch('/api/employees');
    const data = await res.json();
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
    `).join('');
}

async function refreshLogs() {
    const date = document.getElementById('log-date').value;
    const res = await fetch(`/api/logs?limit=50${date ? '&date=' + date : ''}`);
    const data = await res.json();
    const body = document.getElementById('logs-body');
    body.innerHTML = (data.data?.logs || []).map(log => `
        <tr>
            <td>${new Date(log.timestamp).toLocaleString()}</td>
            <td>${log.user_id}</td>
            <td><span class="badge ${log.type == 0 ? 'badge-success' : 'badge-warning'}">${log.type == 0 ? 'CHECK-IN' : 'CHECK-OUT'}</span></td>
            <td>${log.device_sn || '-'}</td>
        </tr>
    `).join('');
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
    const res = await fetch('/api/sync/all', { method: 'POST' }); // Usually sync all includes employees in this app logic
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

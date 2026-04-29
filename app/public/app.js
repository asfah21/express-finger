// State management
let currentUser = null;
let currentPath = 'overview';

const paginationState = {
    overview: { page: 0, size: 10, total: 0 },
    devices: { page: 0, size: 10, total: 0 },
    employees: { page: 0, size: 25, total: 0 },
    logs: { page: 0, size: 25, total: 0 },
    activity: { page: 0, size: 25, total: 0 }
};

// Theme setup
const savedTheme = localStorage.getItem('theme') || 'dark';
if (savedTheme === 'light') {
    document.documentElement.classList.add('theme-light');
}

// Set initial theme icons
document.addEventListener('DOMContentLoaded', () => {
    const isLight = document.documentElement.classList.contains('theme-light');
    const icons = document.querySelectorAll('.theme-toggle i');
    icons.forEach(icon => {
        icon.classList.remove('fa-moon', 'fa-sun');
        icon.classList.add(isLight ? 'fa-moon' : 'fa-sun');
    });
});

function toggleTheme() {
    const root = document.documentElement;
    const icons = document.querySelectorAll('.theme-toggle i');
    if (root.classList.contains('theme-light')) {
        root.classList.remove('theme-light');
        localStorage.setItem('theme', 'dark');
        icons.forEach(icon => {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        });
    } else {
        root.classList.add('theme-light');
        localStorage.setItem('theme', 'light');
        icons.forEach(icon => {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        });
    }
}

/**
 * Get YYYY-MM-DD in WITA (UTC+8) timezone
 */
function getWitaDateString() {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Makassar',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
    } catch (e) {
        // Fallback to UTC+8 manual calculation if Intl fails
        const now = new Date();
        const wita = new Date(now.getTime() + (8 * 60 * 60 * 1000));
        return wita.toISOString().split('T')[0];
    }
}

// Initial check - dijalankan hanya sekali saat load halaman
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

// Silent token validator - hanya redirect ke login jika token benar-benar expired/invalid
// Tidak memanggil showDashboard() agar tidak mereset UI
async function silentTokenCheck() {
    // Hanya cek jika user sudah login
    if (!currentUser) return;
    try {
        const response = await fetch('/auth/me');
        if (!response.ok) {
            // Token expired atau invalid, redirect ke login
            currentUser = null;
            showLogin();
        }
        // Jika OK, tidak lakukan apa-apa (biarkan UI tetap seperti adanya)
    } catch (err) {
        // Network error - jangan redirect, mungkin sementara
        console.warn('Auth check failed (network?), will retry later.');
    }
}

function showLogin() {
    document.getElementById('login-view').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';

    // Update nav profile name
    const navUserEl = document.getElementById('nav-username');
    if (navUserEl && currentUser && currentUser.username) {
        navUserEl.innerText = currentUser.username;
    }

    applyRoleRestrictions();

    // Restore page from URL hash or default to overview
    const hash = window.location.hash.replace('#', '');
    const validPages = ['overview', 'devices', 'employees', 'logs', 'activity', 'settings'];
    if (hash && validPages.includes(hash)) {
        showPage(hash);
    } else {
        showPage('overview');
    }
}

function applyRoleRestrictions() {
    if (!currentUser) return;
    const isAdmin = currentUser.role === 'admin';
    
    // Elements with class admin-only should be hidden for viewers
    document.querySelectorAll('.admin-only').forEach(el => {
        if (!isAdmin) {
            el.style.display = 'none';
        } else {
            // Restore display if it was hidden
            el.style.display = '';
        }
    });

    // If viewer tries to access settings, redirect to overview
    if (!isAdmin && currentPath === 'settings') {
        showPage('overview');
    }
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

function toggleLoginPassword() {
    const input = document.getElementById('login-password');
    const icon = document.getElementById('toggle-password-icon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

async function logout() {
    await fetch('/auth/logout', { method: 'POST' });
    showLogin();
}

function showPage(pageId) {
    if (pageId === 'settings' && currentPath !== 'settings') {
        openSettingsAuth();
        return;
    }

    currentPath = pageId;
    window.location.hash = pageId; // Save state to URL hash

    // Update header title
    const titles = {
        'overview': 'System Overview',
        'devices': 'Devices & Sync',
        'employees': 'Employee Management',
        'logs': 'Attendance Logs',
        'activity': 'Activity Log',
        'settings': 'System Settings'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.innerText = titles[pageId] || 'Dashboard';

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
    if (pageId === 'overview') {
        paginationState.overview.page = 0; // Always reset to page 0 for overview
        refreshOverview();
    }
    if (pageId === 'devices') refreshDevices();
    if (pageId === 'employees') refreshEmployees();
    if (pageId === 'logs') refreshLogs();
    if (pageId === 'activity') refreshActivityLogs();
    if (pageId === 'settings') {
        loadSettings();
        loadUserList(); // Load user list when settings page is opened
    }

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
    if (section === 'devices') refreshDevices();
    if (section === 'employees') refreshEmployees();
    if (section === 'logs') refreshLogs();
    if (section === 'activity') refreshActivityLogs();
}

function nextPage(section) {
    const s = paginationState[section];
    if ((s.page + 1) * s.size < s.total) {
        s.page++;
        if (section === 'overview') refreshOverview();
        if (section === 'devices') refreshDevices();
        if (section === 'employees') refreshEmployees();
        if (section === 'logs') refreshLogs();
        if (section === 'activity') refreshActivityLogs();
    }
}

function prevPage(section) {
    const s = paginationState[section];
    if (s.page > 0) {
        s.page--;
        if (section === 'overview') refreshOverview();
        if (section === 'devices') refreshDevices();
        if (section === 'employees') refreshEmployees();
        if (section === 'logs') refreshLogs();
        if (section === 'activity') refreshActivityLogs();
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
    if (section === 'activity') refreshActivityLogs();
}

// Pages Logic
async function refreshOverview() {
    try {
        const s = paginationState.overview;
        const today = getWitaDateString();
        const [devicesRes, empRes, logsRes] = await Promise.all([
            fetch('/api/devices?limit=1'), // Just to get total
            fetch('/api/employees?limit=1'), // Just to get total
            fetch(`/api/logs?from=${today}T00:00:00&limit=${s.size}&offset=${s.page * s.size}`)
        ]);

        // Cek response.ok sebelum parse untuk mencegah crash/freeze
        if (!devicesRes.ok || !empRes.ok || !logsRes.ok) {
            console.warn('One or more API responses failed, skipping overview update.');
            return;
        }

        const devicesData = await devicesRes.json();
        const employeesData = await empRes.json();
        const logsData = await logsRes.json();

        document.getElementById('stat-devices').innerText = devicesData.data?.total || 0;
        document.getElementById('stat-employees').innerText = employeesData.data?.total || 0;

        // Logs stats (today)
        document.getElementById('stat-logs').innerText = '...';
        fetch(`/api/logs?from=${today}T00:00:00%2B08:00`).then(r => {
            if (!r.ok) return null;
            return r.json();
        }).then(d => {
            if (d) document.getElementById('stat-logs').innerText = d.data?.total || 0;
        }).catch(() => { }); // Abaikan error pada fetch tambahan ini

        s.total = logsData.data?.total || 0;
        renderRecentLogs(logsData.data?.logs || []);
        updatePaginationUI('overview');

        // Fetch late staff for today
        refreshLateToday(today);

        // Update last update time
        const lastUpdateEl = document.getElementById('overview-last-update');
        if (lastUpdateEl) {
            lastUpdateEl.innerText = 'Last Updated: ' + new Date().toLocaleTimeString('id-ID');
        }
    } catch (err) {
        console.error('Failed to refresh overview', err);
        // Jangan tampilkan error ke UI, biarkan data lama tetap
    }
}

function renderRecentLogs(logs) {
    const body = document.getElementById('recent-logs-body');
    body.innerHTML = logs.map(log => {
        const dt = new Date(log.timestamp);
        // Use ISO split to match Attendance Logs logic exactly
        const timeStr = dt.toISOString().split('T')[1].substring(0, 5);
        const secondsStr = dt.toISOString().split('T')[1].substring(6, 8);

        return `
            <tr>
                <td>
                    <i class="fas fa-history" style="color: var(--warning); margin-right: 0.5rem; font-size: 0.8rem;"></i>
                    <strong style="color: var(--warning); font-size: 1.05rem;">${timeStr}</strong>
                    <small style="opacity: 0.5; font-size: 0.7rem;">:${secondsStr}</small>
                </td>
                <td>
                    <div style="font-weight: 600;">${log.nama || log.user_id}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">ID: ${log.user_id}</div>
                </td>
                <td><span class="badge ${log.type == 0 ? 'badge-success' : 'badge-warning'}">${log.absensi || (log.type == 0 ? 'Masuk' : 'Pulang')}</span></td>
                <td>
                    <div style="font-size: 0.85rem; font-weight: 500; display: flex; align-items: center; gap: 0.4rem;">
                        <i class="fas fa-wifi" style="font-size: 0.75rem; color: var(--primary); opacity: 0.7;"></i>
                        ${log.device_name || log.device_sn || '-'}
                    </div>
                </td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;"><i class="fas fa-info-circle" style="margin-right:0.5rem"></i>No activity recorded today.</td></tr>';
}

async function refreshLateToday(today) {
    try {
        // Fetch all check-in (type=0) logs from today onward
        const res = await fetch(`/api/logs?from=${today}T00:00:00&type=0&limit=5000`);
        const data = await res.json();
        const logs = data.data?.logs || [];

        // Filter: only S75/S77 staff who have "Terlambat" in ket
        const staffLate = logs.filter(log =>
            (log.emp_type === 'S75' || log.emp_type === 'S77') &&
            log.ket && log.ket.toLowerCase().includes('terlambat')
        );

        // Deduplicate by user_id (keep earliest check-in per person)
        const seen = new Map();
        for (const log of staffLate) {
            if (!seen.has(log.user_id)) {
                seen.set(log.user_id, log);
            }
        }
        const unique = Array.from(seen.values()).slice(0, 10);

        // Update count badge
        const countEl = document.getElementById('late-today-count');
        if (countEl) countEl.innerText = seen.size;

        const body = document.getElementById('late-today-body');
        body.innerHTML = unique.map((log, idx) => {
            const dt = new Date(log.timestamp);
            const timeStr = dt.toISOString().split('T')[1].substring(0, 5);
            return `
                <tr>
                    <td style="color: var(--text-muted);">${idx + 1}</td>
                    <td>
                        <div style="font-weight: 600;">${log.nama || 'Unknown'}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">NIK: ${log.nik || '-'}</div>
                    </td>
                    <td>${log.department || '-'}</td>
                    <td>${log.jabatan || '-'}</td>
                    <td><strong style="color: var(--error); font-size: 1.05rem;">${timeStr}</strong></td>
                    <td><span style="color: var(--error); font-weight: 500;">${log.ket}</span></td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;"><i class="fas fa-check-circle" style="color: var(--success); margin-right: 0.5rem;"></i>No late staff today — great job!</td></tr>';
    } catch (err) {
        console.error('Failed to fetch late today', err);
        document.getElementById('late-today-body').innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Failed to load data</td></tr>';
    }
}

async function refreshDevices() {
    const s = paginationState.devices;
    const res = await fetch(`/api/devices?limit=${s.size}&offset=${s.page * s.size}`);
    const data = await res.json();

    s.total = data.data?.total || 0;
    const body = document.getElementById('devices-body');
    const isAdmin = currentUser && currentUser.role === 'admin';
    body.innerHTML = (data.data?.list || []).map(dev => `
        <tr>
            <td><span class="badge ${dev.is_active ? 'badge-success' : 'badge-error'}">${dev.is_active ? 'Online' : 'Offline'}</span></td>
            <td>${dev.name || 'Unnamed'}</td>
            <td>${dev.ip}</td>
            <td>${dev.sn || '-'}</td>
            <td><span class="badge">${dev.sync_mode || 'HYBRID'}</span></td>
            <td>${dev.last_sync ? new Date(dev.last_sync).toLocaleString() : 'Never'}</td>
            <td>
                <div class="action-dropdown">
                    <button class="icon-btn" onclick="toggleActions(event, this)" title="Actions">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="action-menu">
                        <button class="action-item" onclick="syncDevice('${dev.sn}')"><i class="fas fa-sync"></i> Sync Device</button>
                        ${isAdmin ? `
                        <button class="action-item" onclick="openEditDevice(${dev.id}, '${dev.name || ''}')"><i class="fas fa-edit"></i> Edit Name</button>
                        <button class="action-item delete" onclick="deleteDevice(${dev.id})"><i class="fas fa-trash"></i> Delete</button>
                        ` : ''}
                    </div>
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="7" style="text-align: center;">No devices found</td></tr>';

    updatePaginationUI('devices');
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
    const isAdmin = currentUser && currentUser.role === 'admin';
    body.innerHTML = (data.data?.list || []).map(emp => `
        <tr>
            <td>${emp.user_id}</td>
            <td>${emp.nik || '-'}</td>
            <td>${emp.nama || 'Unnamed'}</td>
            <td>${emp.jabatan || '-'}</td>
            <td>${emp.department || '-'}</td>
            <td><span class="badge" style="background: rgba(255,255,255,0.1);">${emp.divisi || '-'}</span></td>
            <td><span class="badge" style="background: var(--primary); color: #ffffff !important;">${emp.type || '-'}</span></td>
            <td>
                ${isAdmin ? `
                <div class="action-dropdown">
                    <button class="icon-btn" onclick="toggleActions(event, this)" title="Actions">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="action-menu">
                        <button class="action-item" onclick="editEmployee('${emp.id}')"><i class="fas fa-edit"></i> Edit Info</button>
                        <button class="action-item delete" onclick="deleteEmployee('${emp.id}')"><i class="fas fa-trash"></i> Delete</button>
                    </div>
                </div>
                ` : '-'}
            </td>
        </tr>
    `).join('') || '<tr><td colspan="8" style="text-align: center;">No employees found</td></tr>';

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

    document.getElementById('modal-title').innerText = 'Edit Employee Info';
    document.getElementById('modal-content').innerHTML = `
        <div class="form-row">
            <div class="form-group">
                <label>User ID</label>
                <input type="text" id="emp-uid" value="${emp.user_id}">
            </div>
            <div class="form-group">
                <label>Shift Type</label>
                <select id="emp-type">
                    <option value="" ${!emp.type ? 'selected' : ''}>None</option>
                    <option value="S75" ${emp.type === 'S75' ? 'selected' : ''}>S75 (Staff 07-17)</option>
                    <option value="S77" ${emp.type === 'S77' ? 'selected' : ''}>S77 (Staff 07-19)</option>
                    <option value="N66" ${emp.type === 'N66' ? 'selected' : ''}>N66 (Non-Staff 6 ke 6)</option>
                    <option value="N77" ${emp.type === 'N77' ? 'selected' : ''}>N77 (Non-Staff 7 ke 7)</option>
                    <option value="N88" ${emp.type === 'N88' ? 'selected' : ''}>N88 (Non-Staff 8 ke 8)</option>
                    <option value="N99" ${emp.type === 'N99' ? 'selected' : ''}>N99 (Non-Staff 9 ke 9)</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label>Full Name</label>
            <input type="text" id="emp-name" value="${emp.nama || ''}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>NIK</label>
                <input type="text" id="emp-nik" value="${emp.nik || ''}">
            </div>
            <div class="form-group">
                <label>Jabatan</label>
                <input type="text" id="emp-jabatan" value="${emp.jabatan || ''}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Department</label>
                <input type="text" id="emp-dept" value="${emp.department || ''}">
            </div>
            <div class="form-group">
                <label>Divisi</label>
                <input type="text" id="emp-divisi" value="${emp.divisi || ''}" placeholder="GA, IT, etc.">
            </div>
        </div>
    `;
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = 'Save Changes';
    saveBtn.style.display = 'block';
    saveBtn.onclick = () => saveEditEmployee(id);
    toggleModal(true);
}

async function saveEditEmployee(id) {
    const data = {
        user_id: document.getElementById('emp-uid').value,
        nama: document.getElementById('emp-name').value,
        nik: document.getElementById('emp-nik').value,
        jabatan: document.getElementById('emp-jabatan').value,
        department: document.getElementById('emp-dept').value,
        divisi: document.getElementById('emp-divisi').value,
        type: document.getElementById('emp-type').value
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
    showConfirm({
        title: 'Delete Employee',
        message: 'Are you sure you want to delete this employee? This action cannot be undone.',
        icon: 'fa-user-minus',
        confirmText: 'Delete Employee',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            const res = await fetch('/api/employees/' + id, { method: 'DELETE' });
            if (res.ok) {
                showToast('Employee deleted', 'success');
                refreshEmployees();
            } else {
                showToast('Delete failed', 'error');
            }
        }
    });
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
    if (fromDate) url += `&from=${fromDate}T00:00:00%2B08:00`;
    if (toDate) url += `&to=${toDate}T23:59:59%2B08:00`;
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
            </tr>
        `;
    }).join('') || '<tr><td colspan="7" style="text-align: center;">No logs found</td></tr>';

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

        const today = getWitaDateString();

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
            if (fromDate) url += `&from=${fromDate}T00:00:00%2B08:00`;
            if (toDate) url += `&to=${toDate}T23:59:59%2B08:00`;
        }

        if (search) url += `&search=${encodeURIComponent(search)}`;

        const res = await fetch(url);
        const data = await res.json();
        const logs = data.data?.logs || [];

        const exportData = logs.map(log => {
            const dt = new Date(log.timestamp);
            const timeFull = dt.toISOString().split('T')[1].substring(0, 8); // hh:mm:ss
            return {
                NIK: log.nik,
                Name: log.nama,
                'User ID': log.user_id,
                Department: log.department,
                Divisi: log.divisi,
                Jabatan: log.jabatan,
                Status: log.absensi,
                Date: `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}/${dt.getUTCFullYear()}`,
                Time: timeFull,
                Device: log.device_name,
                Remarks: log.ket
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance Logs");

        const filename = `attendance_${range}_${today}.xlsx`;
        XLSX.writeFile(workbook, filename);
        showToast('Export successful', 'success');
        // Record activity
        await recordClientActivity('export_attendance', 'export', `Exported attendance logs (range: ${range}, count: ${logs.length})`);
    } catch (err) {
        showToast('Export failed', 'error');
    }
}

// ============================================================
// Activity Log Functions
// ============================================================

let activitySearchTimer;
function handleActivitySearch(val) {
    clearTimeout(activitySearchTimer);
    activitySearchTimer = setTimeout(() => {
        if (val.length >= 2 || val.length === 0) {
            paginationState.activity.page = 0;
            refreshActivityLogs();
        }
    }, 600);
}

function applyActivityFilter() {
    paginationState.activity.page = 0;
    refreshActivityLogs();
}

async function refreshActivityLogs() {
    const s = paginationState.activity;
    const search = document.getElementById('activity-search')?.value || '';
    const category = document.getElementById('activity-category')?.value || '';
    const from = document.getElementById('activity-date-from')?.value || '';
    const to = document.getElementById('activity-date-to')?.value || '';

    let url = `/api/activity-logs?limit=${s.size}&offset=${s.page * s.size}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    if (from) url += `&from=${from}T00:00:00%2B08:00`;
    if (to) url += `&to=${to}T23:59:59%2B08:00`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            document.getElementById('activity-body').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--error)">Failed to load activity logs</td></tr>';
            return;
        }
        const data = await res.json();

        s.total = data.data?.total || 0;
        const body = document.getElementById('activity-body');

        const categoryColors = {
            auth: '#60a5fa',
            employee: '#34d399',
            device: '#a78bfa',
            settings: '#fbbf24',
            export: '#f59e0b',
            import: '#10b981',
            sync: '#6366f1',
            general: '#9ca3af'
        };

        const actionIcons = {
            login: 'fa-sign-in-alt',
            logout: 'fa-sign-out-alt',
            add_employee: 'fa-user-plus',
            edit_employee: 'fa-user-edit',
            delete_employee: 'fa-user-minus',
            import_employees: 'fa-file-import',
            add_device: 'fa-plus-circle',
            edit_device: 'fa-edit',
            delete_device: 'fa-trash',
            sync_device: 'fa-sync',
            sync_all: 'fa-sync-alt',
            update_settings: 'fa-cog',
            update_account: 'fa-user-cog',
            export_attendance: 'fa-file-excel',
            export_employees: 'fa-file-excel',
        };

        body.innerHTML = (data.data?.logs || []).map(log => {
            const dt = new Date(log.created_at);
            const dateStr = dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const catColor = categoryColors[log.category] || '#9ca3af';
            const icon = actionIcons[log.action] || 'fa-circle';
            const isSuccess = log.status === 'success';

            return `
                <tr>
                    <td>
                        <div style="font-weight:500;font-size:0.85rem;">${dateStr}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);">${timeStr}</div>
                    </td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.5rem;">
                            <div style="width:30px;height:30px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;flex-shrink:0;">${(log.username || '?')[0].toUpperCase()}</div>
                            <strong>${log.username || '-'}</strong>
                        </div>
                    </td>
                    <td>
                        <span class="badge" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}44;">
                            ${log.category || '-'}
                        </span>
                    </td>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.4rem;">
                            <i class="fas ${icon}" style="font-size:0.8rem;color:${catColor};"></i>
                            <span style="font-size:0.85rem;">${log.action || '-'}</span>
                        </div>
                    </td>
                    <td style="max-width:280px;">
                        <div style="font-size:0.82rem;color:var(--text-muted);white-space:normal;line-height:1.4;">${log.detail || '-'}</div>
                    </td>
                    <td style="font-size:0.8rem;color:var(--text-muted);">${log.ip_address || '-'}</td>
                    <td>
                        <span class="badge ${isSuccess ? 'badge-success' : 'badge-error'}">
                            <i class="fas ${isSuccess ? 'fa-check' : 'fa-times'}"></i> ${log.status || '-'}
                        </span>
                    </td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;"><i class="fas fa-shield-alt" style="margin-right:0.5rem;"></i>No activity logs found.</td></tr>';

        updatePaginationUI('activity');
    } catch (err) {
        console.error('Failed to load activity logs', err);
    }
}

async function clearOldActivityLogs() {
    showConfirm({
        title: 'Clear Old Activity Logs',
        message: 'This will delete all activity logs older than 90 days. This action cannot be undone.',
        icon: 'fa-trash-alt',
        confirmText: 'Clear Old Logs',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            const res = await fetch('/api/activity-logs/old?days=90', { method: 'DELETE' });
            if (res.ok) {
                const data = await res.json();
                showToast(data.message, 'success');
                refreshActivityLogs();
            } else {
                showToast('Failed to clear logs', 'error');
            }
        }
    });
}

// Helper: record activity to server (for client-side actions like export)
async function recordClientActivity(action, category, detail) {
    try {
        await fetch('/api/activity-logs/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, category, detail })
        });
    } catch (_) { }
}

// Settings Logic
async function loadSettings() {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.status === 'success') {
        const s = data.data;
        document.getElementById('setting-api-key').value = s.api_key || '';
        document.getElementById('setting-cleanup-days').value = s.cleanup_age_days || 30;
        document.getElementById('setting-late-tolerance').value = s.late_tolerance_mins || 5;

        // Remarks config
        const r = s.remarks_config || {};
        document.getElementById('remark-late').value = r.late || '';
        document.getElementById('remark-early-arrival').value = r.early_arrival || '';
        document.getElementById('remark-early-departure').value = r.early_departure || '';
        document.getElementById('remark-overtime').value = r.overtime_check || '';
        document.getElementById('remark-duplicate').value = r.duplicate || '';

        // Shifts config
        document.getElementById('setting-shift-types').value = JSON.stringify(s.shift_types || {}, null, 4);
    }
}

async function updateSettings(payload, successMsg) {
    showToast('Saving changes...');
    try {
        const res = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast(successMsg, 'success');
        } else {
            showToast('Failed to save settings', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

async function saveSystemSettings() {
    const apiKey = document.getElementById('setting-api-key').value;
    const cleanupDays = document.getElementById('setting-cleanup-days').value;
    await updateSettings({
        api_key: apiKey,
        cleanup_age_days: parseInt(cleanupDays)
    }, 'System preferences updated');
}

async function saveAttendanceSettings() {
    const lateTolerance = document.getElementById('setting-late-tolerance').value;
    await updateSettings({
        late_tolerance_mins: parseInt(lateTolerance)
    }, 'Attendance rules updated');
}

async function saveRemarksSettings() {
    const payload = {
        remarks_config: {
            late: document.getElementById('remark-late').value,
            early_arrival: document.getElementById('remark-early-arrival').value,
            early_departure: document.getElementById('remark-early-departure').value,
            overtime_check: document.getElementById('remark-overtime').value,
            duplicate: document.getElementById('remark-duplicate').value
        }
    };
    await updateSettings(payload, 'Attendance remarks updated');
}

async function saveShiftSettings() {
    try {
        const jsonStr = document.getElementById('setting-shift-types').value;
        const shiftTypes = JSON.parse(jsonStr);
        await updateSettings({ shift_types: shiftTypes }, 'Shift configurations updated');
    } catch (err) {
        showToast('Invalid JSON format for Shift Config', 'error');
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

// ============================================================
// User Management Logic
// ============================================================

function toggleNewUserPassword() {
    const input = document.getElementById('new-user-password');
    const icon = document.getElementById('new-user-pass-icon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

async function loadUserList() {
    const container = document.getElementById('user-list-container');
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
        const res = await fetch('/auth/users');
        if (!res.ok) throw new Error('Failed to load users');
        const data = await res.json();

        if (!data.data || data.data.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;">No users found</div>';
            return;
        }

        container.innerHTML = `
            <div style="overflow-x:auto; width:100%;">
                <table style="width:100%;font-size:0.85rem;border-collapse:collapse;min-width:400px;">
                    <thead>
                        <tr style="border-bottom:1px solid var(--glass-border);color:var(--text-muted);">
                            <th style="padding:0.5rem;text-align:left;">Username</th>
                            <th style="padding:0.5rem;text-align:left;">Role</th>
                            <th style="padding:0.5rem;text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.data.map(user => `
                            <tr style="border-bottom:1px solid var(--glass-border);">
                                <td style="padding:0.5rem;font-weight:600;">
                                    <div style="display:flex;align-items:center;gap:0.5rem;">
                                        <div style="width:24px;height:24px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.6rem;flex-shrink:0;">${user.username[0].toUpperCase()}</div>
                                        <span style="white-space:nowrap;">${user.username}</span>
                                        ${currentUser?.username === user.username ? '<span class="badge" style="background:var(--success);color:#fff;font-size:0.6rem;padding:0.1rem 0.3rem;">You</span>' : ''}
                                    </div>
                                </td>
                                <td style="padding:0.5rem;">
                                    <span class="badge" style="background:${user.role === 'admin' ? 'var(--secondary)' : 'var(--glass-border)'};color:${user.role === 'admin' ? '#fff' : 'inherit'};white-space:nowrap;">
                                        ${user.role}
                                    </span>
                                </td>
                                <td style="padding:0.5rem;text-align:right;white-space:nowrap;">
                                    <button class="icon-btn" title="Reset Password" onclick="resetUserPasswordPrompt(${user.id}, '${user.username}')" style="margin-right:0.25rem;">
                                        <i class="fas fa-key" style="color:var(--warning);"></i>
                                    </button>
                                    <button class="icon-btn" title="Delete User" onclick="deleteUserPrompt(${user.id}, '${user.username}')" ${currentUser?.username === user.username ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
                                        <i class="fas fa-trash" style="${currentUser?.username !== user.username ? 'color:var(--error);' : ''}"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div style="text-align:center;color:var(--error);padding:1.5rem;"><i class="fas fa-exclamation-triangle"></i> Error loading users</div>`;
    }
}

async function addNewUser() {
    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;

    if (!username || !password) {
        return showToast('Username and password are required', 'warning');
    }
    if (password.length < 6) {
        return showToast('Password must be at least 6 characters', 'warning');
    }

    try {
        const res = await fetch('/auth/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        const data = await res.json();

        if (res.ok) {
            showToast('User created successfully', 'success');
            document.getElementById('new-user-username').value = '';
            document.getElementById('new-user-password').value = '';
            loadUserList(); // Refresh list
        } else {
            showToast(data.message || 'Failed to create user', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

function deleteUserPrompt(id, username) {
    showConfirm({
        title: 'Delete User',
        message: `Are you sure you want to delete user <strong>${username}</strong>? This action cannot be undone.`,
        icon: 'fa-user-minus',
        confirmText: 'Delete User',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            try {
                const res = await fetch(`/auth/users/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (res.ok) {
                    showToast(data.message || 'User deleted', 'success');
                    loadUserList();
                } else {
                    showToast(data.message || 'Failed to delete user', 'error');
                }
            } catch (err) {
                showToast('Network error', 'error');
            }
        }
    });
}

function resetUserPasswordPrompt(id, username) {
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');
    const saveBtn = document.getElementById('modal-save-btn');

    title.innerText = `Reset Password for ${username}`;
    content.innerHTML = `
        <div class="form-group">
            <label>New Password <span style="font-size:0.75rem;color:var(--text-muted);">(min. 6 characters)</span></label>
            <div style="position:relative;">
                <input type="password" id="reset-password-input" placeholder="••••••••" style="padding-right:3rem;" autocomplete="new-password">
                <button type="button" onclick="const i = document.getElementById('reset-password-input'); i.type = i.type === 'password' ? 'text' : 'password';"
                    style="position:absolute;right:0.875rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0;display:flex;align-items:center;">
                    <i class="fas fa-eye"></i>
                </button>
            </div>
        </div>
    `;

    saveBtn.innerText = 'Reset Password';
    saveBtn.style.display = 'block';
    
    saveBtn.onclick = () => {
        const newPass = document.getElementById('reset-password-input').value;
        if (newPass.length < 6) {
            return showToast('Password must be at least 6 characters', 'error');
        }

        fetch(`/auth/users/${id}/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: newPass })
        }).then(res => res.json()).then(data => {
            if (data.status === 'success') {
                showToast(`Password for ${username} has been reset`, 'success');
                closeModal();
            } else {
                showToast(data.message || 'Failed to reset password', 'error');
            }
        }).catch(() => showToast('Network error', 'error'));
    };

    toggleModal(true);
    setTimeout(() => document.getElementById('reset-password-input')?.focus(), 150);
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
    showConfirm({
        title: 'Delete Device',
        message: 'Are you sure you want to delete this device? Connection to this hardware will be removed.',
        icon: 'fa-microchip',
        confirmText: 'Delete Device',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            const res = await fetch('/api/devices/' + id, { method: 'DELETE' });
            if (res.ok) {
                showToast('Device deleted', 'success');
                refreshDevices();
            } else {
                showToast('Delete failed', 'error');
            }
        }
    });
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

        // Hapus kolom yang tidak diperlukan
        const cleanedEmployees = employees.map(emp => {
            const { id, created_at, updated_at, ...rest } = emp;
            return rest;
        });

        // Buat sheet dari data JSON
        const worksheet = XLSX.utils.json_to_sheet(cleanedEmployees);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Employees");

        // Export file
        XLSX.writeFile(workbook, `employees_export_${getWitaDateString()}.xlsx`);
        showToast('Export successful');
        await recordClientActivity('export_employees', 'export', `Exported ${employees.length} employees to Excel`);
    } catch (err) {
        showToast('Export failed', 'error');
    }
}

function downloadImportTemplate() {
    const data = [
        {
            user_id: 101,
            nama: "John Doe",
            nik: "12345678",
            jabatan: "Staff IT",
            department: "GSI",
            divisi: "IT",
            type: "S75"
        },
        {
            user_id: 102,
            nama: "Jane Smith",
            nik: "87654321",
            jabatan: "Operator",
            department: "GSI",
            divisi: "Production",
            type: "N77"
        }
    ];
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Import_Template");
    XLSX.writeFile(workbook, "template_import_karyawan.xlsx");
}

function showImportModal() {
    toggleModal(true);
    document.getElementById('modal-title').innerText = 'Import Employees';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 2rem;">
            <i class="fas fa-file-excel" style="font-size: 3.5rem; color: var(--success); margin-bottom: 1rem;"></i>
            <p style="color: var(--text-muted); margin-bottom: 1.5rem;">Please download the template below, fill in your employee data, and then use the upload button to import.</p>
            
            <button class="btn-primary" onclick="downloadImportTemplate()" style="background: rgba(119, 160, 68, 0.15); color: var(--secondary); border: 1px solid var(--secondary); box-shadow: none; width: auto; margin-bottom: 0.5rem;">
                <i class="fas fa-download"></i> Download Template (.xlsx)
            </button>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 1rem; border-top: 1px solid var(--glass-border); pt: 1.5rem; margin-top: 0.5rem; padding-top: 1.5rem;">
             <button class="btn-primary" onclick="document.getElementById('import-file').click()" style="background: var(--primary);">
                <i class="fas fa-upload"></i> Choose File & Start Import
             </button>
             <p style="font-size: 0.75rem; color: var(--text-muted); text-align: center;">Maximum 5000 rows per import.</p>
        </div>
    `;
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.style.display = 'none';
}

function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    toggleModal(false); // Close the guideline modal 
    showToast('Reading file...');

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
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = 'Add Device';
    saveBtn.style.display = 'block';
    saveBtn.onclick = saveNewDevice;
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
        <div class="form-row">
            <div class="form-group">
                <label>User ID</label>
                <input type="text" id="emp-uid" placeholder="e.g. 101">
            </div>
            <div class="form-group">
                <label>Shift Type</label>
                <select id="emp-type">
                    <option value="" selected>None</option>
                    <option value="S75">S75 (Staff 07-17)</option>
                    <option value="S77">S77 (Staff 07-19)</option>
                    <option value="N66">N66 (Non-Staff 6 ke 6)</option>
                    <option value="N77">N77 (Non-Staff 7 ke 7)</option>
                    <option value="N88">N88 (Non-Staff 8 ke 8)</option>
                    <option value="N99">N99 (Non-Staff 9 ke 9)</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label>Full Name</label>
            <input type="text" id="emp-name" placeholder="John Doe">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>NIK</label>
                <input type="text" id="emp-nik" placeholder="123456">
            </div>
            <div class="form-group">
                <label>Jabatan</label>
                <input type="text" id="emp-jabatan" placeholder="Staff IT">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Department</label>
                <input type="text" id="emp-dept" placeholder="GSI">
            </div>
            <div class="form-group">
                <label>Divisi</label>
                <input type="text" id="emp-divisi" placeholder="GA, IT, etc.">
            </div>
        </div>
    `;
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = 'Save Employee';
    saveBtn.style.display = 'block';
    saveBtn.onclick = saveNewEmployee;
    toggleModal(true);
}

// Confirm Modal Helper
function showConfirm({ title, message, icon, confirmText, confirmColor, onConfirm }) {
    toggleModal(true);
    const titleEl = document.getElementById('modal-title');
    titleEl.style.display = 'none'; // Hide default top title

    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 1rem; padding: 1rem 0;">
            <i class="fas ${icon || 'fa-exclamation-triangle'} pulse-animation" style="font-size: 4.5rem; color: ${confirmColor || 'var(--warning)'}; margin-bottom: 2rem; display: block;"></i>
            <h2 style="margin-bottom: 1rem; color: var(--text); font-size: 1.75rem; font-weight: 700;">${title}</h2>
            <p style="color: var(--text-muted); font-size: 1.1rem; line-height: 1.6; max-width: 420px; margin: 0 auto;">${message}</p>
        </div>
    `;

    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = confirmText || 'Confirm';
    saveBtn.style.display = 'block';

    // Clear previous classes and add appropriate ones
    saveBtn.className = 'btn-primary';
    if (confirmColor === 'var(--error)' || confirmColor === '#f87171') {
        saveBtn.classList.add('btn-danger');
    } else {
        saveBtn.style.background = confirmColor || 'var(--primary)';
    }

    saveBtn.onclick = () => {
        toggleModal(false);
        if (onConfirm) onConfirm();
    };
}

async function saveNewEmployee() {
    const data = {
        user_id: document.getElementById('emp-uid').value,
        nama: document.getElementById('emp-name').value,
        nik: document.getElementById('emp-nik').value,
        jabatan: document.getElementById('emp-jabatan').value,
        department: document.getElementById('emp-dept').value,
        divisi: document.getElementById('emp-divisi').value,
        type: document.getElementById('emp-type').value
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
    const saveBtn = document.getElementById('modal-save-btn');
    const titleEl = document.getElementById('modal-title');

    if (show) {
        overlay.classList.add('active');
        // Reset button style & class to default (removes btn-danger etc.)
        if (saveBtn) {
            saveBtn.className = 'btn-primary';
            saveBtn.style.background = '';
            saveBtn.style.display = 'block';
        }
        // Restore title visibility (showConfirm hides it)
        if (titleEl) {
            titleEl.style.display = '';
        }
    } else {
        overlay.classList.remove('active');
    }
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

        // Fetch data
        loadSettings();
        loadUserList();
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

// Action Dropdown logic
function toggleActions(e, btn) {
    if (e) e.stopPropagation();
    const menu = btn.nextElementSibling;
    const isActive = menu.classList.contains('active');

    // Close all other menus first
    document.querySelectorAll('.action-menu').forEach(m => m.classList.remove('active'));

    if (!isActive) {
        menu.classList.add('active');
    }
}

// Close dropdowns when clicking outside
window.addEventListener('click', () => {
    document.querySelectorAll('.action-menu').forEach(m => m.classList.remove('active'));
});

// Initialize
checkAuth();

// Silent auth check setiap 10 menit - hanya redirect jika token expired
// Tidak mereset UI / memaksa re-render dashboard
setInterval(silentTokenCheck, 10 * 60 * 1000);

// Auto refresh overview data setiap 2 menit (hanya saat di halaman overview)
setInterval(() => {
    if (currentUser && currentPath === 'overview') {
        refreshOverview();
    }
}, 120000);

// Handle window resize for pagination
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (currentPath === 'overview') updatePaginationUI('overview');
        if (currentPath === 'employees') updatePaginationUI('employees');
        if (currentPath === 'logs') updatePaginationUI('logs');
        if (currentPath === 'activity') updatePaginationUI('activity');
    }, 250);
});
// Handle browser back/forward buttons
window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    const validPages = ['overview', 'devices', 'employees', 'logs', 'activity', 'settings'];
    if (hash && validPages.includes(hash) && hash !== currentPath) {
        showPage(hash);
    }
});

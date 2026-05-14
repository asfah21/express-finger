import { state } from './js/state.js';
import { getWitaDateString, showToast, toggleModal, showConfirm } from './js/utils.js';
import { refreshOverview } from './js/pages/overview.js';
import { checkAuth, handleLogin, logout, silentTokenCheck } from './js/auth.js';
import { refreshDevices, syncDevice, openAddDevice, openEditDevice, deleteDevice } from './js/pages/devices.js';
import { refreshEmployees, handleEmployeeSearch, editEmployee, deleteEmployee, openAddEmployee, exportEmployees, showImportModal, handleImport, downloadImportTemplate } from './js/pages/employees.js';
import { refreshLogs, handleLogSearch, showExportMenu } from './js/pages/logs.js';
import { refreshActivityLogs, handleActivitySearch, applyActivityFilter, clearOldActivityLogs, recordClientActivity } from './js/pages/activity.js';
import { loadSettings, saveSystemSettings, saveAttendanceSettings, saveRemarksSettings, saveShiftSettings, updateAccount, toggleNewUserPassword, loadUserList, addNewUser, deleteUserPrompt, resetUserPasswordPrompt, openSettingsAuth } from './js/pages/settings.js';
import { refreshPull, handlePullData, changePullView, nextPullPage, prevPullPage, savePulledLogs, exportPulledData, downloadRawData } from './js/pages/pull.js';




// Expose to window for HTML onclick handlers
window.toggleTheme = toggleTheme;
window.showPage = showPage;
window.updatePageSize = updatePageSize;
window.nextPage = nextPage;
window.prevPage = prevPage;
window.goToPage = goToPage;
window.syncAll = syncAll;
window.logout = logout;
window.handleLogin = handleLogin;
window.toggleLoginPassword = toggleLoginPassword;
window.toggleSidebar = toggleSidebar;
window.closeModal = () => toggleModal(false);
window.updatePaginationUI = updatePaginationUI;
window.showDashboard = showDashboard;
window.showLogin = showLogin;

// Device Page Functions
window.refreshDevices = refreshDevices;
window.syncDevice = syncDevice;
window.openAddDevice = openAddDevice;
window.openEditDevice = openEditDevice;
window.deleteDevice = deleteDevice;

// Employee Page Functions
window.refreshEmployees = refreshEmployees;
window.handleEmployeeSearch = handleEmployeeSearch;
window.editEmployee = editEmployee;
window.deleteEmployee = deleteEmployee;
window.openAddEmployee = openAddEmployee;
window.exportEmployees = exportEmployees;
window.showImportModal = showImportModal;
window.handleImport = handleImport;
window.downloadImportTemplate = downloadImportTemplate;

// Logs Page Functions
window.refreshLogs = refreshLogs;
window.handleLogSearch = handleLogSearch;
window.showExportMenu = showExportMenu;
window.applyLogFilter = () => { state.pagination.logs.page = 0; refreshLogs(); };

// Activity Page Functions
window.refreshActivityLogs = refreshActivityLogs;
window.handleActivitySearch = handleActivitySearch;
window.applyActivityFilter = applyActivityFilter;
window.clearOldActivityLogs = clearOldActivityLogs;
window.recordClientActivity = recordClientActivity;

// Settings Page Functions
window.loadSettings = loadSettings;
window.saveSystemSettings = saveSystemSettings;
window.saveAttendanceSettings = saveAttendanceSettings;
window.saveRemarksSettings = saveRemarksSettings;
window.saveShiftSettings = saveShiftSettings;
window.updateAccount = updateAccount;
window.toggleNewUserPassword = toggleNewUserPassword;
window.loadUserList = loadUserList;
window.addNewUser = addNewUser;
window.deleteUserPrompt = deleteUserPrompt;
window.resetUserPasswordPrompt = resetUserPasswordPrompt;
window.openSettingsAuth = openSettingsAuth;

// Pull Data Page Functions
window.refreshPull = refreshPull;
window.handlePullData = handlePullData;
window.changePullView = changePullView;
window.nextPullPage = nextPullPage;
window.prevPullPage = prevPullPage;
window.savePulledLogs = savePulledLogs;
window.exportPulledData = exportPulledData;
window.downloadRawData = downloadRawData;




// For legacy code within this file that hasn't been moved yet
const paginationState = state.pagination;


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

// These functions are now imported from js/auth.js


function showLogin() {
    document.getElementById('login-view').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';

    // Update nav profile name
    const navUserEl = document.getElementById('nav-username');
    if (navUserEl && state.currentUser && state.currentUser.username) {
        navUserEl.innerText = state.currentUser.username;
    }

    applyRoleRestrictions();

    // Restore page from URL hash or default to overview
    const hash = window.location.hash.replace('#', '');
    const validPages = ['overview', 'devices', 'employees', 'logs', 'pull', 'activity', 'settings'];
    if (hash && validPages.includes(hash)) {
        showPage(hash);
    } else {
        showPage('overview');
    }
}

function applyRoleRestrictions() {
    if (!state.currentUser) return;
    const isAdmin = state.currentUser.role === 'admin';

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
    if (!isAdmin && state.currentPath === 'settings') {
        showPage('overview');
    }
}

// handleLogin moved to auth.js


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

// logout moved to auth.js


function showPage(pageId) {
    if (pageId === 'settings' && state.currentPath !== 'settings') {
        openSettingsAuth();
        return;
    }

    state.currentPath = pageId;
    window.location.hash = pageId; // Save state to URL hash

    // Update header title
    const titles = {
        'overview': 'System Overview',
        'devices': 'Devices & Sync',
        'employees': 'Employee Management',
        'logs': 'Attendance Logs',
        'activity': 'Activity Log',
        'pull': 'Pull Data',
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
    if (pageId === 'pull') refreshPullDevices();
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
// refreshOverview and its helpers moved to js/pages/overview.js


async function refreshDevices() {
    const s = paginationState.devices;
    const res = await fetch(`/api/devices?limit=${s.size}&offset=${s.page * s.size}`);
    const data = await res.json();

    s.total = data.data?.total || 0;
    const body = document.getElementById('devices-body');
    const isAdmin = state.currentUser && state.currentUser.role === 'admin';
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
    const isAdmin = state.currentUser && state.currentUser.role === 'admin';
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

// refreshLogs moved to js/pages/logs.js


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

// Activity log functions moved to js/pages/activity.js


// Settings logic moved to js/pages/settings.js


// User management logic moved to js/pages/settings.js


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

// Initialization and Global Event Listeners
// ============================================================

// Auto refresh overview data setiap 2 menit (hanya saat di halaman overview)
setInterval(() => {
    if (state.currentUser && state.currentPath === 'overview') {
        refreshOverview();
    }
}, 120000);

// Handle window resize for pagination
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (state.currentPath === 'overview') updatePaginationUI('overview');
        if (state.currentPath === 'employees') updatePaginationUI('employees');
        if (state.currentPath === 'logs') updatePaginationUI('logs');
        if (state.currentPath === 'activity') updatePaginationUI('activity');
    }, 250);
});

// Handle browser back/forward buttons
window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    const validPages = ['overview', 'devices', 'employees', 'logs', 'pull', 'activity', 'settings'];
    if (hash && validPages.includes(hash) && hash !== state.currentPath) {
        showPage(hash);
    }
});

// Run initial auth check and setup silent token check
checkAuth();
setInterval(silentTokenCheck, 60000); // Check token every minute


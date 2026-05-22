import { state } from './js/state.js';
import { getWitaDateString, showToast, toggleModal, showConfirm } from './js/utils.js';
import { refreshOverview } from './js/pages/overview.js';
import { checkAuth, handleLogin, logout, silentTokenCheck } from './js/auth.js';
import { refreshDevices, syncDevice, openAddDevice, openEditDevice, deleteDevice } from './js/pages/devices.js';
import { refreshEmployees, handleEmployeeSearch, editEmployee, deleteEmployee, openAddEmployee, exportEmployees, showImportModal, handleImport, downloadImportTemplate, syncEmployeeToDevice } from './js/pages/employees.js';
import { refreshLogs, handleLogSearch, showExportMenu } from './js/pages/logs.js';
import { refreshActivityLogs, handleActivitySearch, applyActivityFilter, clearOldActivityLogs, recordClientActivity } from './js/pages/activity.js';
import { loadSettings, saveSystemSettings, saveAttendanceSettings, saveRemarksSettings, saveShiftSettings, updateAccount, toggleNewUserPassword, loadUserList, addNewUser, deleteUserPrompt, resetUserPasswordPrompt, openSettingsAuth } from './js/pages/settings.js';
import { refreshPull, pullDataFromDevice, switchPullView, nextPullPage, prevPullPage, updatePullPageSize, exportPulledData, downloadRawData } from './js/pages/pull.js';
import { refreshPair } from './js/pages/pair.js';
import { refreshPullEmployee, pullEmployeeDataFromDevice, switchPullEmployeeView, nextPullEmployeePage, prevPullEmployeePage, updatePullEmployeePageSize, exportPulledEmployeeData, downloadRawEmployeeData, showSyncModal, closeSyncModal } from './js/pages/pull-employee.js';

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
window.toggleActions = toggleActions;

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
window.syncEmployeeToDevice = syncEmployeeToDevice;

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
window.pullDataFromDevice = pullDataFromDevice;
window.switchPullView = switchPullView;
window.nextPullPage = nextPullPage;
window.prevPullPage = prevPullPage;
window.updatePullPageSize = updatePullPageSize;
window.exportPulledData = exportPulledData;
window.downloadRawData = downloadRawData;

// Pull Employee Page Functions
window.refreshPullEmployee = refreshPullEmployee;
window.pullEmployeeDataFromDevice = pullEmployeeDataFromDevice;
window.switchPullEmployeeView = switchPullEmployeeView;
window.nextPullEmployeePage = nextPullEmployeePage;
window.prevPullEmployeePage = prevPullEmployeePage;
window.updatePullEmployeePageSize = updatePullEmployeePageSize;
window.exportPulledEmployeeData = exportPulledEmployeeData;
window.downloadRawEmployeeData = downloadRawEmployeeData;
window.showSyncModal = showSyncModal;
window.closeSyncModal = closeSyncModal;
window.updateEmployeeDeviceStatus = function() {};




// For legacy code within this file that hasn't been moved yet
const paginationState = state.pagination;


const savedTheme = localStorage.getItem('theme') || 'dark';
if (savedTheme === 'light') {
    document.documentElement.classList.add('theme-light');
}

// UI Core Functions
// ============================================================

function showLogin() {
    document.getElementById('login-view').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';

    const navUserEl = document.getElementById('nav-username');
    if (navUserEl && state.currentUser && state.currentUser.username) {
        navUserEl.innerText = state.currentUser.username;
    }

    applyRoleRestrictions();

    const hash = window.location.hash.replace('#', '');
    const validPages = ['overview', 'devices', 'employees', 'logs', 'pair', 'pull', 'pull-employee', 'activity', 'settings'];
    if (hash && validPages.includes(hash)) {
        showPage(hash);
    } else {
        showPage('overview');
    }
}

function applyRoleRestrictions() {
    if (!state.currentUser) return;
    const isAdmin = state.currentUser.role === 'admin';

    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });

    if (!isAdmin && state.currentPath === 'settings') {
        showPage('overview');
    }
}

function showPage(pageId) {
    if (pageId === 'settings' && !state.isSettingsUnlocked) {
        openSettingsAuth();
        return;
    }

    state.currentPath = pageId;
    window.location.hash = pageId;

    const titles = {
        'overview': 'System Overview',
        'devices': 'Devices & Sync',
        'employees': 'Employee List',
        'logs': 'Attendance Log',
        'pair': 'Attendance Pair',
        'activity': 'Activity Log',
        'pull': 'Pull Data',
        'pull-employee': 'Pull Employee',
        'settings': 'System Settings'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.innerText = titles[pageId] || 'Dashboard';

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('onclick')?.includes(`'${pageId}'`)) {
            item.classList.add('active');

            // Auto-expand parent submenu if it is a sub-menu item
            const parentSubmenu = item.closest('.submenu-container');
            if (parentSubmenu) {
                parentSubmenu.classList.add('open');
                parentSubmenu.style.maxHeight = parentSubmenu.scrollHeight + 'px';
                const parentItem = parentSubmenu.previousElementSibling;
                if (parentItem) parentItem.classList.add('open');
            }
        }
    });

    // Auto-collapse other submenus that don't contain the active child
    document.querySelectorAll('.submenu-container').forEach(sub => {
        const hasActiveChild = sub.querySelector('.nav-item.active');
        if (!hasActiveChild) {
            sub.classList.remove('open');
            sub.style.maxHeight = '0';
            const parentItem = sub.previousElementSibling;
            if (parentItem) parentItem.classList.remove('open');
        }
    });

    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    const activePage = document.getElementById('page-' + pageId);
    if (activePage) {
        activePage.style.display = 'block';

        if (pageId === 'overview') refreshOverview();
        if (pageId === 'devices') refreshDevices();
        if (pageId === 'employees') refreshEmployees();
        if (pageId === 'logs') refreshLogs();
        if (pageId === 'pair') refreshPair();
        if (pageId === 'activity') refreshActivityLogs();
        if (pageId === 'pull') refreshPull();
        if (pageId === 'pull-employee') refreshPullEmployee();
        if (pageId === 'settings') {
            loadSettings();
            loadUserList();
        }
    }

    if (window.innerWidth < 1024) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        if (sidebar) sidebar.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    }
}

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
    
    // Refresh chart to update colors when theme changes
    if (state.currentPath === 'overview' && typeof refreshOverview === 'function') {
        refreshOverview();
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

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('active');
    if (overlay) overlay.classList.toggle('active');
}

function toggleActions(e, btn) {
    if (e) e.stopPropagation();
    const menu = btn.nextElementSibling;
    const isActive = menu.classList.contains('active');
    document.querySelectorAll('.action-menu').forEach(m => m.classList.remove('active'));
    if (!isActive) menu.classList.add('active');
}

window.addEventListener('click', () => {
    document.querySelectorAll('.action-menu').forEach(m => m.classList.remove('active'));
});

function updatePageSize(type, val) {
    if (!state.pagination[type]) return;
    state.pagination[type].size = parseInt(val);
    state.pagination[type].page = 0;

    if (type === 'overview') refreshOverview();
    if (type === 'devices') refreshDevices();
    if (type === 'employees') refreshEmployees();
    if (type === 'logs') refreshLogs();
    if (type === 'activity') refreshActivityLogs();
}

function nextPage(type) {
    const s = state.pagination[type];
    if (s.page < Math.ceil(s.total / s.size) - 1) {
        s.page++;
        if (type === 'overview') refreshOverview();
        if (type === 'devices') refreshDevices();
        if (type === 'employees') refreshEmployees();
        if (type === 'logs') refreshLogs();
        if (type === 'activity') refreshActivityLogs();
    }
}

function prevPage(type) {
    const s = state.pagination[type];
    if (s.page > 0) {
        s.page--;
        if (type === 'overview') refreshOverview();
        if (type === 'devices') refreshDevices();
        if (type === 'employees') refreshEmployees();
        if (type === 'logs') refreshLogs();
        if (type === 'activity') refreshActivityLogs();
    }
}

function goToPage(type, p) {
    if (!state.pagination[type]) return;
    state.pagination[type].page = p;
    if (type === 'overview') refreshOverview();
    if (type === 'devices') refreshDevices();
    if (type === 'employees') refreshEmployees();
    if (type === 'logs') refreshLogs();
    if (type === 'activity') refreshActivityLogs();
}

function updatePaginationUI(type) {
    const s = state.pagination[type];
    if (!s) return;

    const info = document.getElementById(type + '-info');
    const start = s.page * s.size + 1;
    const end = Math.min((s.page + 1) * s.size, s.total);
    if (info) info.innerText = `Showing ${s.total ? start : 0}-${end} of ${s.total} items`;

    const prevBtn = document.getElementById(type + '-prev-btn');
    const nextBtn = document.getElementById(type + '-next-btn');
    if (prevBtn) prevBtn.disabled = s.page <= 0;
    if (nextBtn) nextBtn.disabled = s.page >= Math.ceil(s.total / s.size) - 1;

    const nums = document.getElementById(type + '-pagination-numbers');
    if (nums) {
        nums.innerHTML = '';
        const totalPages = Math.ceil(s.total / s.size);
        if (totalPages <= 1) return;

        const maxLinks = window.innerWidth < 640 ? 3 : 5;
        let startPage = Math.max(0, s.page - Math.floor(maxLinks / 2));
        let endPage = Math.min(totalPages - 1, startPage + maxLinks - 1);

        if (endPage - startPage < maxLinks - 1) {
            startPage = Math.max(0, endPage - maxLinks + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            const btn = document.createElement('div');
            btn.className = `page-link ${i === s.page ? 'active' : ''}`;
            btn.innerText = i + 1;
            btn.onclick = () => goToPage(type, i);
            nums.appendChild(btn);
        }
    }
}

async function syncAll() {
    showToast('Starting sync for all devices...');
    try {
        const res = await fetch('/api/sync/all', { method: 'POST' });
        if (res.ok) {
            showToast('Sync completed successfully!', 'success');
            refreshOverview();
        } else {
            showToast('Sync failed', 'error');
        }
    } catch (err) {
        showToast('Network error during sync', 'error');
    }
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
    const validPages = ['overview', 'devices', 'employees', 'logs', 'pair', 'pull', 'pull-employee', 'activity', 'settings'];
    if (hash && validPages.includes(hash) && hash !== state.currentPath) {
        showPage(hash);
    }
});

// Run initial auth check and setup silent token check
checkAuth();
setInterval(silentTokenCheck, 60000); // Check token every minute

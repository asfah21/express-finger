import { state } from './js/state.js';
import { getWitaDateString, showToast, toggleModal, showConfirm } from './js/utils.js';
import { refreshOverview } from './js/pages/overview.js';
import { checkAuth, handleLogin, logout, silentTokenCheck } from './js/auth.js';
import { refreshDevices, syncDevice, openAddDevice, openEditDevice, deleteDevice } from './js/pages/devices.js';
import { refreshEmployees, handleEmployeeSearch, editEmployee, deleteEmployee, openAddEmployee, exportEmployees, showImportModal, handleImport, downloadImportTemplate, syncEmployeeToDevice } from './js/pages/employees.js';
import { refreshLogs, handleLogSearch, showExportMenu } from './js/pages/logs.js';
import { refreshActivityLogs, handleActivitySearch, applyActivityFilter, clearOldActivityLogs, exportActivityLogs, recordClientActivity } from './js/pages/activity.js';
import { loadSettings, saveSystemSettings, updateAccount, toggleNewUserPassword, loadUserList, addNewUser, deleteUserPrompt, resetUserPasswordPrompt, loadProfileInfo, toggleProfilePassword, loadPagePermissions, savePagePermission } from './js/pages/settings.js';
import { loadHrSettings, saveHrAttendanceSettings, saveHrRemarksSettings, saveHrShiftSettings, switchHrTab } from './js/pages/hr.js';
import { refreshCacheMetrics, flushCache } from './js/pages/metric.js';
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
window.toggleSidebarCollapse = toggleSidebarCollapse;
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
window.exportActivityLogs = exportActivityLogs;
window.recordClientActivity = recordClientActivity;

// Settings Page Functions
window.loadSettings = loadSettings;
window.saveSystemSettings = saveSystemSettings;
window.updateAccount = updateAccount;
window.toggleNewUserPassword = toggleNewUserPassword;
window.loadUserList = loadUserList;
window.addNewUser = addNewUser;
window.deleteUserPrompt = deleteUserPrompt;
window.resetUserPasswordPrompt = resetUserPasswordPrompt;
window.loadProfileInfo = loadProfileInfo;
window.toggleProfilePassword = toggleProfilePassword;
window.loadPagePermissions = loadPagePermissions;
window.savePagePermission = savePagePermission;

// HR Page Functions
window.loadHrSettings = loadHrSettings;
window.saveHrAttendanceSettings = saveHrAttendanceSettings;
window.saveHrRemarksSettings = saveHrRemarksSettings;
window.saveHrShiftSettings = saveHrShiftSettings;
window.switchHrTab = switchHrTab;


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

// Metric Page Functions
window.refreshCacheMetrics = refreshCacheMetrics;
window.flushCache = flushCache;

// For legacy code within this file that hasn't been moved yet
const paginationState = state.pagination;


// Dark mode persistence - restore saved theme and fix icon
const savedTheme = localStorage.getItem('theme') || 'dark';
if (savedTheme === 'light') {
    document.documentElement.classList.add('theme-light');
    // Fix icon: in light mode, show moon icon (to switch back to dark)
    document.querySelectorAll('.theme-toggle i').forEach(icon => {
        icon.className = 'fas fa-moon';
    });
} else {
    // In dark mode, show sun icon (to switch to light)
    document.querySelectorAll('.theme-toggle i').forEach(icon => {
        icon.className = 'fas fa-sun';
    });
}

// UI Core Functions
// ============================================================

function showLogin() {
    document.getElementById('login-view').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
}

async function showDashboard() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';

    const navUserEl = document.getElementById('nav-username');
    if (navUserEl && state.currentUser && state.currentUser.username) {
        navUserEl.innerText = state.currentUser.username;
    }

    // Load dynamic page permissions from server
    await loadUserPermissions();

    // Apply dynamic sidebar visibility based on permissions
    applyDynamicSidebar();

    // Restore sidebar collapsed state from localStorage
    if (window.innerWidth >= 1024) {
        const sidebar = document.querySelector('.sidebar');
        const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        if (sidebar && isCollapsed) {
            sidebar.classList.add('collapsed');
            const btn = document.querySelector('.sidebar-collapse-btn');
            const icon = btn ? btn.querySelector('i') : null;
            if (icon) icon.className = 'fas fa-chevron-right';
            if (btn) btn.title = 'Expand Sidebar';
        }
    }

    const hash = window.location.hash.replace('#', '');
    if (hash && state.allowedPages.includes(hash)) {
        showPage(hash);
    } else {
        showPage('overview');
    }
}

/**
 * Load user's allowed pages from the server
 */
async function loadUserPermissions() {
    if (!state.currentUser) return;
    try {
        const res = await fetch('/api/my-permissions');
        if (res.ok) {
            const data = await res.json();
            state.allowedPages = (data.data || []).map(p => p.page_id);
            state.allowedPageLabels = (data.data || []).reduce((acc, p) => {
                acc[p.page_id] = p.page_label;
                return acc;
            }, {});
        } else {
            // Fallback: allow all pages for backward compatibility
            state.allowedPages = ['overview', 'devices', 'employees', 'logs', 'pair', 'pull', 'pull-employee', 'activity', 'account', 'settings', 'hr', 'metric'];
            state.allowedPageLabels = {};
        }
    } catch (err) {
        console.warn('Failed to load permissions, using defaults:', err);
        state.allowedPages = ['overview', 'devices', 'employees', 'logs', 'pair', 'pull', 'pull-employee', 'activity', 'account', 'settings', 'hr', 'metric'];
        state.allowedPageLabels = {};
    }
}

/**
 * Apply dynamic sidebar visibility based on user permissions
 * Hides nav items for pages the user doesn't have access to
 */
function applyDynamicSidebar() {
    if (!state.allowedPages || state.allowedPages.length === 0) return;

    // Show/hide individual nav items based on allowed pages
    document.querySelectorAll('.nav-item[onclick*="showPage"]').forEach(item => {
        const match = item.getAttribute('onclick')?.match(/'([^']+)'/);
        if (match) {
            const pageId = match[1];
            if (state.allowedPages.includes(pageId)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        }
    });

    // Handle submenu items
    document.querySelectorAll('.submenu-container .nav-item').forEach(item => {
        const match = item.getAttribute('onclick')?.match(/'([^']+)'/);
        if (match) {
            const pageId = match[1];
            if (state.allowedPages.includes(pageId)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        }
    });

    // Hide parent submenu toggles if all their children are hidden
    document.querySelectorAll('.submenu-container').forEach(sub => {
        const items = sub.querySelectorAll('.nav-item');
        let allHidden = true;
        items.forEach(item => {
            if (item.style.display !== 'none') {
                allHidden = false;
            }
        });
        if (allHidden && items.length > 0) {
            // Hide the parent toggle
            const parentToggle = sub.previousElementSibling;
            if (parentToggle && parentToggle.classList.contains('nav-item')) {
                parentToggle.style.display = 'none';
            }
        }
    });

}

function showPage(pageId) {
    // Dynamic permission guard using allowedPages from server
    if (state.allowedPages && !state.allowedPages.includes(pageId)) {
        showToast('Access denied: You do not have permission to access this page', 'error');
        pageId = 'overview';
        state.currentPath = pageId;
        window.location.hash = pageId;
    }

    state.currentPath = pageId;
    window.location.hash = pageId;

    const defaultTitles = {
        'overview': 'System Overview',
        'devices': 'Devices & Sync',
        'employees': 'Employee List',
        'logs': 'Attendance Log',
        'pair': 'Attendance Pair',
        'activity': 'Activity Log',
        'pull': 'Pull Data',
        'pull-employee': 'Pull Employee',
        'account': 'My Account',
        'settings': 'System Settings',
        'hr': 'HR Settings',
        'metric': 'Cache Metrics'
    };
    // Use dynamic label from server if available, fallback to default
    const pageTitle = state.allowedPageLabels?.[pageId] || defaultTitles[pageId] || 'Dashboard';
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.innerText = pageTitle;
    // Update browser tab title
    document.title = `${pageTitle} - AZRA Fingerprint`;

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

        if (pageId === 'overview') refreshOverview(false); // Pakai cache agar tidak boros API
        if (pageId === 'devices') refreshDevices();
        if (pageId === 'employees') refreshEmployees();
        if (pageId === 'logs') refreshLogs();
        if (pageId === 'pair') refreshPair();
        if (pageId === 'activity') refreshActivityLogs();
        if (pageId === 'pull') refreshPull();
        if (pageId === 'pull-employee') refreshPullEmployee();
        if (pageId === 'account') loadProfileInfo();
        if (pageId === 'settings') {
            loadSettings();
            loadUserList();
            loadPagePermissions();
        }

        if (pageId === 'hr') loadHrSettings();

        if (pageId === 'metric') refreshCacheMetrics();
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

function toggleSidebarCollapse() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    
    // Only works on desktop (>= 1024px)
    if (window.innerWidth < 1024) return;
    
    sidebar.classList.toggle('collapsed');
    
    // Update button icon and title
    const btn = document.querySelector('.sidebar-collapse-btn');
    const icon = btn ? btn.querySelector('i') : null;
    if (btn && icon) {
        if (sidebar.classList.contains('collapsed')) {
            icon.className = 'fas fa-chevron-right';
            btn.title = 'Expand Sidebar';
        } else {
            icon.className = 'fas fa-bars';
            btn.title = 'Collapse Sidebar';
        }
    }
    
    // Persist state
    const isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
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

    if (type === 'overview') refreshOverview(true);
    if (type === 'devices') refreshDevices();
    if (type === 'employees') refreshEmployees();
    if (type === 'logs') refreshLogs();
    if (type === 'activity') refreshActivityLogs();
}

function nextPage(type) {
    const s = state.pagination[type];
    if (s.page < Math.ceil(s.total / s.size) - 1) {
        s.page++;
        if (type === 'overview') refreshOverview(true);
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
        if (type === 'overview') refreshOverview(true);
        if (type === 'devices') refreshDevices();
        if (type === 'employees') refreshEmployees();
        if (type === 'logs') refreshLogs();
        if (type === 'activity') refreshActivityLogs();
    }
}

function goToPage(type, p) {
    if (!state.pagination[type]) return;
    state.pagination[type].page = p;
    if (type === 'overview') refreshOverview(true);
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
    const btn = document.querySelector('[onclick="syncAll()"]');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }
    showToast('Starting sync for all devices...');
    try {
        const res = await fetch('/api/sync/all', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            showToast(data.message || 'Sync completed successfully!', 'success');
            refreshOverview();
        } else {
            const data = await res.json();
            showToast(data.message || 'Sync failed', 'error');
        }
    } catch (err) {
        showToast('Network error during sync', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sync-alt"></i> Sync All';
        }
    }
}

// Initialization and Global Event Listeners
// ============================================================

// Auto refresh overview data setiap 2 menit (hanya saat di halaman overview)
let autoRefreshInterval = null;
let autoRefreshCount = 0;

function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshCount = 0;
    
    autoRefreshInterval = setInterval(() => {
        if (state.currentUser && state.currentPath === 'overview') {
            autoRefreshCount++;
            refreshOverview(true); // Force refresh untuk auto-refresh
            
            // Show subtle indicator that auto-refresh happened
            const indicator = document.getElementById('auto-refresh-indicator');
            if (indicator) {
                indicator.innerText = `Auto-refreshed ${autoRefreshCount}x`;
                indicator.classList.add('visible');
                setTimeout(() => indicator.classList.remove('visible'), 2000);
            }
        }
    }, 120000);
}

// Cache timestamp untuk menghindari refresh berlebihan saat tab kembali aktif
let lastOverviewRefresh = 0;
const OVERVIEW_REFRESH_COOLDOWN = 60000; // 60 detik cooldown

// Refresh data saat user kembali ke tab, tapi dengan cooldown agar tidak boros API
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.currentUser && state.currentPath === 'overview') {
        const now = Date.now();
        if (now - lastOverviewRefresh > OVERVIEW_REFRESH_COOLDOWN) {
            lastOverviewRefresh = now;
            refreshOverview();
        }
    }
});

startAutoRefresh();

// Handle window resize for pagination and sidebar collapse
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (state.currentPath === 'overview') updatePaginationUI('overview');
        if (state.currentPath === 'employees') updatePaginationUI('employees');
        if (state.currentPath === 'logs') updatePaginationUI('logs');
        if (state.currentPath === 'activity') updatePaginationUI('activity');
        
        // Remove collapsed class when entering mobile view
        if (window.innerWidth < 1024) {
            const sidebar = document.querySelector('.sidebar');
            if (sidebar && sidebar.classList.contains('collapsed')) {
                sidebar.classList.remove('collapsed');
                const btn = document.querySelector('.sidebar-collapse-btn');
                const icon = btn ? btn.querySelector('i') : null;
                if (icon) icon.className = 'fas fa-bars';
                if (btn) btn.title = 'Collapse Sidebar';
            }
        }
    }, 250);
});

// Table horizontal scroll shadow detection
// Adds 'scrolled-to-end' class when user scrolls to the far right of a table container
document.addEventListener('scroll', (e) => {
    const container = e.target.closest('.table-container');
    if (container && container.scrollWidth > container.clientWidth) {
        const isAtEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 5;
        container.classList.toggle('scrolled-to-end', isAtEnd);
    }
}, { passive: true, capture: true });

// Handle browser back/forward buttons
window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash && state.allowedPages.includes(hash) && hash !== state.currentPath) {
        showPage(hash);
    }
});


// Run initial auth check and setup silent token check
checkAuth();
setInterval(silentTokenCheck, 60000); // Check token every minute

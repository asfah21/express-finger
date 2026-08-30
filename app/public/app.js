import { state } from './js/state.js';
import { getWitaDateString, showToast, toggleModal, showConfirm } from './js/utils.js';
import { refreshOverview } from './js/pages/overview.js';
import { checkAuth, handleLogin, logout, silentTokenCheck } from './js/auth.js';
import { refreshDevices, syncDevice, openAddDevice, openEditDevice, deleteDevice, toggleTemplateMaster } from './js/pages/devices.js';
import { refreshEmployees, handleEmployeeSearch, editEmployee, deleteEmployee, openAddEmployee, exportEmployees, showImportModal, handleImport, downloadImportTemplate, syncEmployeeToDevice, bulkDeleteEmployees, toggleEmployeeSelectAll, updateEmployeeSelection } from './js/pages/employees.js';
import { refreshLogs, handleLogSearch, showExportMenu } from './js/pages/logs.js';
import { refreshActivityLogs, handleActivitySearch, applyActivityFilter, clearOldActivityLogs, exportActivityLogs, recordClientActivity } from './js/pages/activity.js';
import { loadSettings, saveSystemSettings, saveTemplateSyncSettings, updateAccount, toggleNewUserPassword, loadUserList, addNewUser, deleteUserPrompt, resetUserPasswordPrompt, loadProfileInfo, toggleProfilePassword, loadPagePermissions, savePagePermission, switchSettingsTab, switchAccountTab } from './js/pages/settings.js';
import { loadHrSettings, saveHrAttendanceSettings, saveHrRemarksSettings, saveHrShiftSettings, switchHrTab } from './js/pages/hr.js';
import { refreshCacheMetrics, flushCache } from './js/pages/metric.js';
import { refreshPull, pullDataFromDevice, switchPullView, nextPullPage, prevPullPage, updatePullPageSize, exportPulledData, downloadRawData } from './js/pages/pull.js';
import { refreshPair, populatePairDepartments } from './js/pages/pair.js';
import { refreshPullEmployee, pullEmployeeDataFromDevice, switchPullEmployeeView, nextPullEmployeePage, prevPullEmployeePage, updatePullEmployeePageSize, exportPulledEmployeeData, downloadRawEmployeeData, showSyncModal, closeSyncModal } from './js/pages/pull-employee.js';
import { refreshBiometrics, loadBiometricTemplates, openBiometricModal, saveBiometricTemplate, deleteBiometricTemplate, downloadBiometricTemplate, loadTemplateDevices, pullTemplateMaster, dryRunTemplateSync, pushTemplateSync, pushAllTemplateSync } from './js/pages/biometrics.js';
import { refreshLate, handleLateSearch, showLateExportMenu } from './js/pages/late.js';
import { refreshSessions, handleSessionSearch, killSession, killAllUserSessions, killOtherSessions, startSessionAutoRefresh } from './js/pages/sessions.js';
import { refreshKioskDevices, approveKioskDevice, revokeKioskDevice, unbindKioskDevice, renameKioskDevice } from './js/pages/kiosk-devices.js';
import { initLivePage, initCamLivePage } from './js/live.js';
import { startRealtimeFeed } from './js/realtime.js';



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
window.initLivePage = initLivePage;
window.initCamLivePage = initCamLivePage;

// Device Page Functions
window.refreshDevices = refreshDevices;
window.syncDevice = syncDevice;
window.openAddDevice = openAddDevice;
window.openEditDevice = openEditDevice;
window.deleteDevice = deleteDevice;
window.toggleTemplateMaster = toggleTemplateMaster;

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
window.bulkDeleteEmployees = bulkDeleteEmployees;
window.toggleEmployeeSelectAll = toggleEmployeeSelectAll;
window.updateEmployeeSelection = updateEmployeeSelection;

// Logs Page Functions
window.refreshLogs = refreshLogs;
window.handleLogSearch = handleLogSearch;
window.showExportMenu = showExportMenu;
window.applyLogFilter = () => {
    const fromDate = document.getElementById('log-date-from')?.value;
    const toDate = document.getElementById('log-date-to')?.value;
    if (fromDate && toDate && fromDate > toDate) {
        showToast('Tanggal "From" tidak boleh lebih besar dari "To"', 'warning');
        return;
    }
    state.pagination.logs.page = 0;
    refreshLogs();
};

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
window.switchSettingsTab = switchSettingsTab;
window.switchAccountTab = switchAccountTab;
window.saveTemplateSyncSettings = saveTemplateSyncSettings;

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

// Biometrics Page Functions
window.refreshBiometrics = refreshBiometrics;
window.loadBiometricTemplates = loadBiometricTemplates;
window.openBiometricModal = openBiometricModal;
window.saveBiometricTemplate = saveBiometricTemplate;
window.deleteBiometricTemplate = deleteBiometricTemplate;
window.downloadBiometricTemplate = downloadBiometricTemplate;
window.loadTemplateDevices = loadTemplateDevices;
window.pullTemplateMaster = pullTemplateMaster;
window.dryRunTemplateSync = dryRunTemplateSync;
window.pushTemplateSync = pushTemplateSync;
window.pushAllTemplateSync = pushAllTemplateSync;
window.updateEmployeeDeviceStatus = function () { };

// Late Page Functions
window.refreshLate = refreshLate;
window.handleLateSearch = handleLateSearch;
window.showLateExportMenu = showLateExportMenu;
window.applyLateFilter = () => {
    const fromDate = document.getElementById('late-date-from')?.value;
    const toDate = document.getElementById('late-date-to')?.value;
    if (fromDate && toDate && fromDate > toDate) {
        showToast('Tanggal "From" tidak boleh lebih besar dari "To"', 'warning');
        return;
    }
    state.pagination.late.page = 0;
    refreshLate();
};

// Sessions Page Functions
window.refreshSessions = refreshSessions;
window.handleSessionSearch = handleSessionSearch;
window.killSession = killSession;
window.killAllUserSessions = killAllUserSessions;
window.killOtherSessions = killOtherSessions;

// Kiosk Devices Page Functions
window.refreshKioskDevices = refreshKioskDevices;
window.approveKioskDevice = approveKioskDevice;
window.revokeKioskDevice = revokeKioskDevice;
window.unbindKioskDevice = unbindKioskDevice;
window.renameKioskDevice = renameKioskDevice;

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
    if (state.currentUser?.role === 'public') {
        window.location.replace('/live.html');
        return;
    }
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

    // Apply role-specific visibility after permissions are loaded.
    applyAdminVisibility();
    applySuperAdminVisibility();
    applyLiveVisibility();


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
            state.allowedPages = ['overview', 'devices', 'employees', 'logs', 'pair', 'pull', 'pull-employee', 'late', 'activity', 'account', 'settings', 'hr', 'metric', 'sessions', 'kiosk-devices'];
            state.allowedPageLabels = {};
        }
    } catch (err) {
        console.warn('Failed to load permissions, using defaults:', err);
        state.allowedPages = ['overview', 'devices', 'employees', 'logs', 'pair', 'pull', 'pull-employee', 'late', 'activity', 'account', 'settings', 'hr', 'metric', 'sessions', 'kiosk-devices'];

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

/**
 * Sembunyikan elemen dengan class "superadmin-only" jika user bukan superadmin
 * Ini mencakup tombol Clear Old di Activity Log, menu Settings, Metric, dll.
 */
function applySuperAdminVisibility() {
    const isSuperAdmin = state.currentUser?.role === 'superadmin';
    document.querySelectorAll('.superadmin-only').forEach(el => {
        if (!isSuperAdmin) {
            el.style.display = 'none';
        } else {
            el.style.display = '';
        }
    });
}

/**
 * Sembunyikan elemen dengan class "admin-only" jika user bukan admin/superadmin
 * (Add/Import/Delete buttons, bulk selection, dll). Backend tetap jadi source of truth.
 */
function applyAdminVisibility() {
    const isAdmin = state.currentUser && (state.currentUser.role === 'admin' || state.currentUser.role === 'superadmin');
    document.querySelectorAll('.admin-only').forEach(el => {
        // Hanya sembunyikan untuk non-admin. Jangan memaksa display='' untuk admin
        // agar tidak menimpa inline display:none (mis. employee-selection-bar),
        // yang visibilitasnya diatur oleh logika seleksi, bukan peran.
        if (!isAdmin) el.style.display = 'none';
    });
}

/**
 * Live is intentionally visible only to the kiosk/public role and superadmin.
 * The backend page permission remains the source of truth; this prevents the
 * menu from appearing for admin/viewer users even when fallback permissions
 * are used during a transient API failure.
 */
function applyLiveVisibility() {
    const role = state.currentUser?.role;
    const canUseLive = role === 'public' || role === 'superadmin';
    document.querySelectorAll('.live-access-only').forEach(el => {
        el.style.display = canUseLive && state.allowedPages.includes('live') ? '' : 'none';
    });
}


function showPage(pageId) {
    if (pageId === 'live' && !['public', 'superadmin'].includes(state.currentUser?.role)) {
        showToast('Access denied: Live is available only for public and superadmin users', 'error');
        return;
    }
    if (pageId === 'live') {
        window.location.assign('/live.html');
        return;
    }
    // Biometrics page is temporarily disabled
    if (pageId === 'biometrics') {
        showToast('Biometrics page is temporarily disabled', 'error');
        pageId = 'overview';
        state.currentPath = pageId;
        window.location.hash = pageId;
    }
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
        'live': 'Live Attendance',
        'devices': 'Devices & Sync',
        'employees': 'Employee List',
        'logs': 'Attendance Log',
        'pair': 'Attendance Pair',
        'activity': 'Activity Log',
        'pull': 'Pull Data',
        'pull-employee': 'Pull Employee',
        'biometrics': 'Biometrics',
        'account': 'My Account',
        'settings': 'System Settings',
        'hr': 'HR Settings',
        'late': 'Attendance Late',
        'metric': 'Cache Metrics',
        'sessions': 'Active Sessions',
        'kiosk-devices': 'Kiosk Devices'
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
        if (pageId === 'pair') { populatePairDepartments(); refreshPair(); }
        if (pageId === 'activity') refreshActivityLogs();
        if (pageId === 'pull') refreshPull();
        if (pageId === 'pull-employee') refreshPullEmployee();
        if (pageId === 'biometrics') refreshBiometrics();
        if (pageId === 'account') loadProfileInfo();
        if (pageId === 'settings') {
            loadSettings();
            loadUserList();
            loadPagePermissions();
        }

        if (pageId === 'late') refreshLate();

        if (pageId === 'hr') loadHrSettings();

        if (pageId === 'metric') refreshCacheMetrics();

        if (pageId === 'sessions') refreshSessions();

        if (pageId === 'kiosk-devices') refreshKioskDevices();

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

// Tracks each action menu's original DOM parent so it can be returned to its
// row when closed (prevents orphaned menus accumulating across re-renders).
const actionMenuOrigins = new WeakMap();

let lastActionMenuOpenAt = 0;

/**
 * Find the action menu belonging to a trigger button. While a menu is open it
 * is moved to <body>, so fall back to the id recorded on the button.
 */
function getActionMenu(btn) {
    const next = btn.nextElementSibling;
    if (next && next.classList.contains('action-menu')) return next;
    const id = btn.dataset.actionMenuId;
    return id ? document.getElementById(id) : null;
}

/**
 * Position the open action menu with `position: fixed` relative to the
 * viewport so it escapes clipping scroll containers (e.g. .table-container
 * with overflow-x: auto) and any ancestor stacking context. Auto-flips the
 * menu upward when it would overflow the bottom edge and clamps it to the
 * viewport horizontally.
 */
function positionActionMenu(btn, menu) {
    menu.style.position = 'fixed';
    menu.style.right = 'auto';

    const btnRect = btn.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const GAP = 6;
    const MARGIN = 12; // safe distance from viewport edges

    // Default: right-align the menu with the button (matches the previous
    // `right: 0` behaviour), then clamp inside the viewport.
    let left = btnRect.right - mw;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - mw - MARGIN));

    // Default: open below the button; flip upward if it would overflow.
    let top = btnRect.bottom + GAP;
    if (top + mh > window.innerHeight - MARGIN) {
        top = btnRect.top - mh - GAP;
        if (top < MARGIN) top = Math.max(MARGIN, btnRect.bottom - mh);
    }

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
}

function openActionMenu(btn, menu) {
    // Register the menu's original parent and a stable id the first time it's
    // opened, so it can be found again after being moved and later restored.
    if (!actionMenuOrigins.has(menu)) {
        actionMenuOrigins.set(menu, menu.parentElement);
        menu.id = menu.id || `action-menu-${(Math.random() * 1e9).toString(36)}`;
        btn.dataset.actionMenuId = menu.id;
    }

    // Move the (still hidden) menu under <body> BEFORE it becomes visible so
    // the table's scrollable height never changes (no scroll-jump, no instant
    // scroll-close). Once under <body>, `position: fixed` is always relative
    // to the viewport — no ancestor with transform/filter/backdrop-filter can
    // hijack the containing block and misplace or clip the menu.
    if (menu.parentElement !== document.body) {
        document.body.appendChild(menu);
    }

    menu.classList.add('active');
    positionActionMenu(btn, menu);
    lastActionMenuOpenAt = Date.now();
}

function closeActionMenus() {
    document.querySelectorAll('.action-menu').forEach(m => {
        m.classList.remove('active');
        m.style.position = '';
        m.style.top = '';
        m.style.left = '';
        m.style.right = '';
        // Return the menu to its row so table re-renders don't leak menus.
        // It is display:none here, so this never triggers layout/scroll.
        const origin = actionMenuOrigins.get(m);
        if (origin && m.parentElement !== origin) origin.appendChild(m);
    });
}

function toggleActions(e, btn) {
    if (e) e.stopPropagation();
    const menu = getActionMenu(btn);
    const wasActive = menu ? menu.classList.contains('active') : false;
    closeActionMenus();
    if (!wasActive && menu) openActionMenu(btn, menu);
}

window.addEventListener('click', closeActionMenus);

// A fixed-position menu can drift away from its trigger when the page scrolls
// or the viewport resizes, so close any open menu on those events.
// Capture-phase on document catches scrolls from inner scroll containers
// (scroll events don't bubble). The open-timestamp guard ignores any scroll
// event emitted synchronously while a menu is being opened.
document.addEventListener('scroll', () => {
    if (Date.now() - lastActionMenuOpenAt < 150) return;
    closeActionMenus();
}, { capture: true, passive: true });
window.addEventListener('resize', closeActionMenus, { passive: true });

function updatePageSize(type, val) {
    if (!state.pagination[type]) return;
    state.pagination[type].size = parseInt(val);
    state.pagination[type].page = 0;

    if (type === 'overview') refreshOverview(true);
    if (type === 'devices') refreshDevices();
    if (type === 'employees') refreshEmployees();
    if (type === 'logs') refreshLogs();
    if (type === 'late') refreshLate();
    if (type === 'activity') refreshActivityLogs();
    if (type === 'sessions') refreshSessions();
}

function nextPage(type) {
    const s = state.pagination[type];
    if (s.page < Math.ceil(s.total / s.size) - 1) {
        s.page++;
        if (type === 'overview') refreshOverview(true);
        if (type === 'devices') refreshDevices();
        if (type === 'employees') refreshEmployees();
        if (type === 'logs') refreshLogs();
        if (type === 'late') refreshLate();
        if (type === 'activity') refreshActivityLogs();
        if (type === 'sessions') refreshSessions();
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
        if (type === 'late') refreshLate();
        if (type === 'activity') refreshActivityLogs();
        if (type === 'sessions') refreshSessions();
    }
}

function goToPage(type, p) {
    if (!state.pagination[type]) return;
    state.pagination[type].page = p;
    if (type === 'overview') refreshOverview(true);
    if (type === 'devices') refreshDevices();
    if (type === 'employees') refreshEmployees();
    if (type === 'logs') refreshLogs();
    if (type === 'late') refreshLate();
    if (type === 'activity') refreshActivityLogs();
    if (type === 'sessions') refreshSessions();

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
        if (state.currentPath === 'late') updatePaginationUI('late');
        if (state.currentPath === 'activity') updatePaginationUI('activity');
        if (state.currentPath === 'sessions') updatePaginationUI('sessions');


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

// Subscribe ke feed SSE absensi realtime (cookie JWT dikirim otomatis same-origin)
startRealtimeFeed();

// Auto-refresh the Active Sessions table while the page is open (real-time online status)
startSessionAutoRefresh();

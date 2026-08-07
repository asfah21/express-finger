import { state } from '../state.js';
import { showToast, toggleModal, showConfirm } from '../utils.js';

/**
 * Switch between Settings tabs
 */
export function switchSettingsTab(tabId) {
    document.querySelectorAll('#page-settings .hr-tab').forEach(tab => {
        const isActive = tab.dataset.tab === tabId;
        tab.classList.toggle('active', isActive);
        if (isActive) {
            const color = tab.dataset.color || 'var(--primary)';
            tab.style.setProperty('--tab-active-color', color);
        }
    });
    document.querySelectorAll('#page-settings .hr-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === 'settings-tab-' + tabId);
    });
}
window.switchSettingsTab = switchSettingsTab;

/**
 * Switch between Account tabs
 */
export function switchAccountTab(tabId) {
    document.querySelectorAll('#page-account .hr-tab').forEach(tab => {
        const isActive = tab.dataset.tab === tabId;
        tab.classList.toggle('active', isActive);
        if (isActive) {
            const color = tab.dataset.color || 'var(--primary)';
            tab.style.setProperty('--tab-active-color', color);
        }
    });
    document.querySelectorAll('#page-account .hr-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === 'account-tab-' + tabId);
    });
}
window.switchAccountTab = switchAccountTab;

export async function loadSettings() {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.status === 'success') {
        const s = data.data;
        document.getElementById('setting-api-key').value = s.api_key || '';
        document.getElementById('setting-cleanup-days').value = s.cleanup_age_days || 30;

        // Auto sync employee settings
        const toggle = document.getElementById('setting-auto-sync-employee');
        if (toggle) {
            toggle.checked = s.auto_sync_employee_enabled === true;
        }
        const interval = document.getElementById('setting-auto-sync-interval');
        if (interval) {
            interval.value = s.auto_sync_employee_interval_minutes || 30;
        }
        const templateEnabled = document.getElementById('setting-template-sync-enabled');
        if (templateEnabled) templateEnabled.checked = s.template_sync_enabled === true;
        const templateInterval = document.getElementById('setting-template-sync-interval');
        if (templateInterval) templateInterval.value = s.template_sync_interval_minutes || 60;

        // Load devices into dropdown and restore saved selection
        loadAutoSyncDeviceDropdown(s.auto_sync_employee_device_id);

        // Show current status
        updateAutoSyncStatusUI(s.auto_sync_employee_enabled);
    }
}

/**
 * Load devices from API into the auto sync device dropdown
 * and restore the previously selected device
 */
async function loadAutoSyncDeviceDropdown(savedDeviceId) {
    const select = document.getElementById('setting-auto-sync-device');
    if (!select) return;

    try {
        const res = await fetch('/api/devices');
        const data = await res.json();
        const devices = data.data?.list || data.data || [];

        select.innerHTML = '<option value="">-- Select Device --</option>' +
            devices.map(d => {
                const selected = d.id == savedDeviceId ? 'selected' : '';
                return `<option value="${d.id}" ${selected}>${d.name || d.ip} (${d.sn})${d.ip ? ' - ' + d.ip : ''}</option>`;
            }).join('');
    } catch (err) {
        console.error('Failed to load devices for auto sync dropdown', err);
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

export async function saveSystemSettings() {
    const apiKey = document.getElementById('setting-api-key').value;
    const cleanupDays = document.getElementById('setting-cleanup-days').value;
    await updateSettings({
        api_key: apiKey,
        cleanup_age_days: parseInt(cleanupDays)
    }, 'System preferences updated');
}

/**
 * Update the auto-sync status indicator in the settings UI
 */
function updateAutoSyncStatusUI(enabled) {
    const statusEl = document.getElementById('auto-sync-status');
    if (!statusEl) return;

    if (enabled) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(16, 185, 129, 0.1)';
        statusEl.style.border = '1px solid rgba(16, 185, 129, 0.2)';
        statusEl.style.color = 'var(--success)';
        statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Auto sync is <strong>ACTIVE</strong>. Data will be pulled every <span id="auto-sync-status-interval">30</span> minutes.';

        // Update interval display
        const intervalVal = document.getElementById('setting-auto-sync-interval')?.value || 30;
        const intervalSpan = document.getElementById('auto-sync-status-interval');
        if (intervalSpan) intervalSpan.textContent = intervalVal;
    } else {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239, 68, 68, 0.1)';
        statusEl.style.border = '1px solid rgba(239, 68, 68, 0.2)';
        statusEl.style.color = 'var(--error)';
        statusEl.innerHTML = '<i class="fas fa-minus-circle"></i> Auto sync is <strong>DISABLED</strong>.';
    }
}

/**
 * Save auto sync employee settings
 */
export async function saveAutoSyncSettings() {
    const enabled = document.getElementById('setting-auto-sync-employee').checked;
    const interval = parseInt(document.getElementById('setting-auto-sync-interval').value) || 30;
    const deviceId = document.getElementById('setting-auto-sync-device').value;

    const payload = {
        auto_sync_employee_enabled: enabled,
        auto_sync_employee_interval_minutes: Math.max(5, Math.min(1440, interval)),
        auto_sync_employee_device_id: deviceId ? parseInt(deviceId) : null
    };

    await updateSettings(payload, 'Auto sync employee settings saved');

    // Update status display
    updateAutoSyncStatusUI(enabled);
}

// Expose to window for HTML onclick handlers
window.saveAutoSyncSettings = saveAutoSyncSettings;

export async function saveTemplateSyncSettings() {
    const enabled = document.getElementById('setting-template-sync-enabled')?.checked === true;
    const interval = Number.parseInt(document.getElementById('setting-template-sync-interval')?.value, 10) || 60;
    await updateSettings({ template_sync_enabled: enabled, template_sync_interval_minutes: Math.max(5, Math.min(1440, interval)) }, 'Template sync settings saved');
}
window.saveTemplateSyncSettings = saveTemplateSyncSettings;

export function loadProfileInfo() {
    const user = state.currentUser;
    if (!user) return;

    const initial = (user.username || 'U')[0].toUpperCase();
    const avatarLetter = document.getElementById('profile-avatar-letter');
    const displayName = document.getElementById('profile-display-name');
    const roleBadge = document.getElementById('profile-role-badge');
    const usernameLabel = document.getElementById('profile-username-label');
    const roleLabel = document.getElementById('profile-role-label');

    if (avatarLetter) avatarLetter.textContent = initial;
    if (displayName) displayName.textContent = user.username || '-';
    if (roleBadge) roleBadge.textContent = user.role || '-';
    if (usernameLabel) usernameLabel.textContent = user.username || '-';
    if (roleLabel) roleLabel.textContent = user.role || '-';
}

export async function updateAccount() {
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
            // Refresh profile info
            if (window.checkAuth) {
                await window.checkAuth();
            }
            loadProfileInfo();
        } else {
            const data = await res.json();
            showToast(data.message || 'Update failed', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

export function toggleProfilePassword() {
    const input = document.getElementById('profile-password');
    const icon = document.getElementById('profile-pass-icon');
    if (input && icon) {
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'fas fa-eye-slash';
        } else {
            input.type = 'password';
            icon.className = 'fas fa-eye';
        }
    }
}

export function toggleNewUserPassword() {
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

export async function loadUserList() {
    const container = document.getElementById('user-list-container');
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
        const res = await fetch('/auth/users');
        if (!res.ok) throw new Error('Failed to load users');
        const data = await res.json();

        const users = data.data?.list || data.data || [];
        if (!users || users.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;">No users found</div>';
            return;
        }

        // Role colors for the dropdown options
        const roleColors = {
            'superadmin': 'var(--secondary)',
            'admin': 'var(--primary)',
            'viewer': 'var(--text-muted)'
        };

        const userRows = users.map(user => {
            const isSelf = state.currentUser?.username === user.username;
            return `
                <tr style="border-bottom:1px solid var(--glass-border);">
                    <td style="padding:0.5rem;font-weight:600;">
                        <div style="display:flex;align-items:center;gap:0.5rem;">
                            <div style="width:24px;height:24px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.6rem;flex-shrink:0;">${user.username[0].toUpperCase()}</div>
                            <span style="white-space:nowrap;">${user.username}</span>
                            ${isSelf ? '<span class="badge" style="background:var(--success);color:#fff;font-size:0.6rem;padding:0.1rem 0.3rem;">You</span>' : ''}
                        </div>
                    </td>
                    <td style="padding:0.5rem;">
                        <select class="role-select" data-user-id="${user.id}" data-username="${user.username}" data-original-role="${user.role}"
                            ${isSelf ? 'disabled style="opacity:0.6;cursor:not-allowed;"' : ''}
                            onchange="confirmRoleChange(this, ${user.id}, '${user.username}')"
                            style="padding:0.25rem 0.5rem;border-radius:0.375rem;border:1px solid var(--glass-border);background:var(--card-bg);color:var(--text);font-size:0.8rem;cursor:pointer;">
                            <option value="superadmin" ${user.role === 'superadmin' ? 'selected' : ''} style="background:${roleColors.superadmin};color:#fff;">superadmin</option>
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''} style="background:${roleColors.admin};color:#fff;">admin</option>
                            <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''} style="background:${roleColors.viewer};color:#fff;">viewer</option>
                        </select>
                    </td>
                    <td style="padding:0.5rem;text-align:right;white-space:nowrap;">
                        <button class="icon-btn" title="Reset Password" onclick="resetUserPasswordPrompt(${user.id}, '${user.username}')" style="margin-right:0.25rem;">
                            <i class="fas fa-key" style="color:var(--warning);"></i>
                        </button>
                        <button class="icon-btn" title="Delete User" onclick="deleteUserPrompt(${user.id}, '${user.username}')" ${isSelf ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
                            <i class="fas fa-trash" style="${!isSelf ? 'color:var(--error);' : ''}"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

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
                        ${userRows}
                    </tbody>
                </table>
            </div>
        `;
    } catch (err) {
        console.error('loadUserList error:', err);
        container.innerHTML = `<div style="text-align:center;color:var(--error);padding:1.5rem;"><i class="fas fa-exclamation-triangle"></i> Error loading users</div>`;
    }
}

export async function addNewUser() {
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
            loadUserList();
        } else {
            showToast(data.message || 'Failed to create user', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

export function deleteUserPrompt(id, username) {
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

export function resetUserPasswordPrompt(id, username) {
    document.getElementById('modal-title').innerText = `Reset Password for ${username}`;
    document.getElementById('modal-content').innerHTML = `
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

    const saveBtn = document.getElementById('modal-save-btn');
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
                toggleModal(false);
            } else {
                showToast(data.message || 'Failed to reset password', 'error');
            }
        }).catch(() => showToast('Network error', 'error'));
    };

    toggleModal(true);
    setTimeout(() => document.getElementById('reset-password-input')?.focus(), 150);
}

/**
 * Prompt confirmation before changing a user's role
 */
export function confirmRoleChange(selectEl, userId, username) {
    const newRole = selectEl.value;
    const oldRole = selectEl.dataset.originalRole || '';

    showConfirm({
        title: 'Change User Role',
        message: `Are you sure you want to change <strong>${username}</strong>'s role from <strong>${oldRole}</strong> to <strong>${newRole}</strong>?`,
        icon: 'fa-user-shield',
        confirmText: 'Change Role',
        confirmColor: 'var(--warning)',
        onConfirm: () => updateUserRole(userId, username, newRole),
        onCancel: () => {
            // Reset dropdown to original value
            loadUserList();
        }
    });
}

// Expose to window for HTML onchange handlers
window.confirmRoleChange = confirmRoleChange;

/**
 * Update a user's role when the dropdown changes
 */
export async function updateUserRole(userId, username, newRole) {
    try {
        const res = await fetch(`/auth/users/${userId}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Role updated for "${username}" to ${newRole}`, 'success');
            // Re-fetch the user list to reflect changes
            loadUserList();
        } else {
            showToast(data.message || 'Failed to update role', 'error');
            // Re-fetch to reset the dropdown to original value
            loadUserList();
        }
    } catch (err) {
        showToast('Network error', 'error');
        loadUserList();
    }
}

// Expose to window for HTML onchange handlers
window.updateUserRole = updateUserRole;

export function openSettingsAuth() {
    document.getElementById('modal-title').innerText = 'Settings Authentication';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 1.5rem;">
            <i class="fas fa-shield-alt" style="font-size: 3rem; color: var(--warning); margin-bottom: 1rem;"></i>
            <p style="color: var(--text-muted);">Please enter your password to access system settings.</p>
        </div>
        <div class="form-group">
            <label>Confirm Password</label>
            <input type="password" id="settings-auth-pass" placeholder="••••••••">
        </div>
    `;
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = 'Unlock Settings';
    saveBtn.style.display = 'block';
    saveBtn.onclick = async () => {
        const password = document.getElementById('settings-auth-pass').value;
        if (!password) return showToast('Password is required', 'warning');

        try {
            const res = await fetch('/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (res.ok) {
                state.isSettingsUnlocked = true;
                toggleModal(false);
                showPage('settings');
            } else {
                showToast('Invalid password', 'error');
            }
        } catch (err) {
            showToast('Network error', 'error');
        }
    };
    toggleModal(true);
    setTimeout(() => document.getElementById('settings-auth-pass')?.focus(), 150);
}

/**
 * Load all page permissions from the server and render the UI
 */
export async function loadPagePermissions() {
    const container = document.getElementById('page-permissions-container');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:0.9rem;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    try {
        const res = await fetch('/api/page-permissions');
        if (!res.ok) throw new Error('Failed to load permissions');
        const data = await res.json();

        const permissions = data.data || [];
        if (!permissions || permissions.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;">No page permissions configured</div>';
            return;
        }

        // Keep this list aligned with the roles accepted by the permissions API.
        // `public` is a real role used by the Live Attendance kiosk; omitting it
        // here made the UI appear to support only three roles and made existing
        // public permissions impossible to manage from Settings.
        const allRoles = ['superadmin', 'admin', 'viewer', 'public'];
        const roleColors = {
            'superadmin': 'var(--secondary)',
            'admin': 'var(--primary)',
            'viewer': 'var(--text-muted)',
            'public': 'var(--success)'
        };

        container.innerHTML = `
            <div style="overflow-x:auto; width:100%;">
                <table style="width:100%;font-size:0.85rem;border-collapse:collapse;min-width:600px;">
                    <thead>
                        <tr style="border-bottom:1px solid var(--glass-border);color:var(--text-muted);">
                            <th style="padding:0.5rem;text-align:left;">Page</th>
                            ${allRoles.map(role => `
                                <th style="padding:0.5rem;text-align:center;text-transform:capitalize;">
                                    <span class="badge" style="background:${roleColors[role]};color:#fff;padding:0.2rem 0.5rem;font-size:0.7rem;">
                                        ${role}
                                    </span>
                                </th>
                            `).join('')}
                            <th style="padding:0.5rem;text-align:center;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${permissions.map(perm => {
            const roles = perm.allowed_roles || [];
            return `
                                <tr style="border-bottom:1px solid var(--glass-border);" data-perm-id="${perm.id}">
                                    <td style="padding:0.5rem;font-weight:600;white-space:nowrap;">
                                        <div style="display:flex;align-items:center;gap:0.5rem;">
                                            <i class="fas fa-file-alt" style="color:var(--text-muted);font-size:0.75rem;"></i>
                                            ${perm.page_label}
                                            <span style="font-size:0.7rem;color:var(--text-muted);font-weight:normal;">(${perm.page_id})</span>
                                        </div>
                                    </td>
                                    ${allRoles.map(role => `
                                        <td style="padding:0.5rem;text-align:center;">
                                            <input type="checkbox" 
                                                class="perm-checkbox" 
                                                data-perm-id="${perm.id}" 
                                                data-role="${role}" 
                                                ${roles.includes(role) ? 'checked' : ''}
                                                style="width:18px;height:18px;cursor:pointer;accent-color:${roleColors[role]};">
                                        </td>
                                    `).join('')}
                                    <td style="padding:0.5rem;text-align:center;">
                                        <button class="btn-primary" style="padding:0.3rem 0.8rem;font-size:0.75rem;" 
                                            onclick="savePagePermission(${perm.id})">
                                            <i class="fas fa-save"></i> Save
                                        </button>
                                    </td>
                                </tr>
                            `;
        }).join('')}
                    </tbody>
                </table>
            </div>
            <div style="margin-top:1rem;padding:0.75rem;background:rgba(251,191,36,0.1);border-radius:0.5rem;border:1px solid rgba(251,191,36,0.2);font-size:0.8rem;color:var(--text-muted);">
                <i class="fas fa-info-circle" style="color:var(--warning);margin-right:0.5rem;"></i>
                <strong>Note:</strong> Changes take effect immediately. Users may need to refresh the page to see updated sidebar.
            </div>
        `;
    } catch (err) {
        console.error('loadPagePermissions error:', err);
        container.innerHTML = `<div style="text-align:center;color:var(--error);padding:1.5rem;"><i class="fas fa-exclamation-triangle"></i> Error loading page permissions</div>`;
    }
}

/**
 * Save a single page permission
 */
export async function savePagePermission(permId) {
    const checkboxes = document.querySelectorAll(`.perm-checkbox[data-perm-id="${permId}"]`);
    const allowedRoles = [];

    checkboxes.forEach(cb => {
        if (cb.checked) {
            allowedRoles.push(cb.dataset.role);
        }
    });

    if (allowedRoles.length === 0) {
        return showToast('At least one role must be selected', 'warning');
    }

    try {
        const res = await fetch(`/api/page-permissions/${permId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allowed_roles: allowedRoles })
        });

        const data = await res.json();
        if (res.ok) {
            showToast('Page permission updated successfully', 'success');
        } else {
            showToast(data.message || 'Failed to update permission', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

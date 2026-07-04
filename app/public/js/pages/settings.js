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

        const userRows = users.map(user => {
            const roleBadgeColor = user.role === 'superadmin' ? 'var(--secondary)' : user.role === 'admin' ? 'var(--primary)' : 'var(--text-muted)';
            return `
                <tr style="border-bottom:1px solid var(--glass-border);">
                    <td style="padding:0.5rem;font-weight:600;">
                        <div style="display:flex;align-items:center;gap:0.5rem;">
                            <div style="width:24px;height:24px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.6rem;flex-shrink:0;">${user.username[0].toUpperCase()}</div>
                            <span style="white-space:nowrap;">${user.username}</span>
                            ${state.currentUser?.username === user.username ? '<span class="badge" style="background:var(--success);color:#fff;font-size:0.6rem;padding:0.1rem 0.3rem;">You</span>' : ''}
                        </div>
                    </td>
                    <td style="padding:0.5rem;">
                        <span class="badge" style="background:${roleBadgeColor};color:#fff;white-space:nowrap;">
                            ${user.role}
                        </span>
                    </td>
                    <td style="padding:0.5rem;text-align:right;white-space:nowrap;">
                        <button class="icon-btn" title="Reset Password" onclick="resetUserPasswordPrompt(${user.id}, '${user.username}')" style="margin-right:0.25rem;">
                            <i class="fas fa-key" style="color:var(--warning);"></i>
                        </button>
                        <button class="icon-btn" title="Delete User" onclick="deleteUserPrompt(${user.id}, '${user.username}')" ${state.currentUser?.username === user.username ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
                            <i class="fas fa-trash" style="${state.currentUser?.username !== user.username ? 'color:var(--error);' : ''}"></i>
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

        const allRoles = ['superadmin', 'admin', 'viewer'];
        const roleColors = {
            'superadmin': 'var(--secondary)',
            'admin': 'var(--primary)',
            'viewer': 'var(--text-muted)'
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


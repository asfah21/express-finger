import { state } from '../state.js';
import { showToast, toggleModal, showConfirm } from '../utils.js';

export async function loadSettings() {
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

export async function saveSystemSettings() {
    const apiKey = document.getElementById('setting-api-key').value;
    const cleanupDays = document.getElementById('setting-cleanup-days').value;
    await updateSettings({
        api_key: apiKey,
        cleanup_age_days: parseInt(cleanupDays)
    }, 'System preferences updated');
}

export async function saveAttendanceSettings() {
    const lateTolerance = document.getElementById('setting-late-tolerance').value;
    await updateSettings({
        late_tolerance_mins: parseInt(lateTolerance)
    }, 'Attendance rules updated');
}

export async function saveRemarksSettings() {
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

export async function saveShiftSettings() {
    try {
        const jsonStr = document.getElementById('setting-shift-types').value;
        const shiftTypes = JSON.parse(jsonStr);
        await updateSettings({ shift_types: shiftTypes }, 'Shift configurations updated');
    } catch (err) {
        showToast('Invalid JSON format for Shift Config', 'error');
    }
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
            // window.checkAuth is global
            if (window.checkAuth) window.checkAuth();
        } else {
            const data = await res.json();
            showToast(data.message || 'Update failed', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
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
                                        ${state.currentUser?.username === user.username ? '<span class="badge" style="background:var(--success);color:#fff;font-size:0.6rem;padding:0.1rem 0.3rem;">You</span>' : ''}
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
                                    <button class="icon-btn" title="Delete User" onclick="deleteUserPrompt(${user.id}, '${user.username}')" ${state.currentUser?.username === user.username ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
                                        <i class="fas fa-trash" style="${state.currentUser?.username !== user.username ? 'color:var(--error);' : ''}"></i>
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
                toggleModal(false);
                state.currentPath = 'settings';
                window.location.hash = 'settings';
                
                // Fetch data
                loadSettings();
                loadUserList();
                
                // Force UI update
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.getElementById('settings').classList.add('active');
                document.querySelectorAll('.nav-links li').forEach(li => {
                    li.classList.remove('active');
                    if (li.getAttribute('onclick')?.includes('settings')) li.classList.add('active');
                });
                document.getElementById('header-title').innerText = 'System Settings';
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

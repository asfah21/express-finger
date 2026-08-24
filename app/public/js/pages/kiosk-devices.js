import { state } from '../state.js';
import { showToast, showConfirm, toggleModal } from '../utils.js';
import { showSkeleton } from '../skeleton.js';

const BUSINESS_TIME_ZONE = 'Asia/Makassar';

const STATUS_META = {
    pending: { label: 'Pending', color: '#f59e0b' },
    approved: { label: 'Approved', color: '#10b981' },
    revoked: { label: 'Revoked', color: '#ef4444' },
};

function formatDateTime(value) {
    if (!value) return '-';
    try {
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: BUSINESS_TIME_ZONE,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).format(new Date(value));
    } catch (e) {
        return new Date(value).toLocaleString();
    }
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&' + 'amp;',
        '<': '&' + 'lt;',
        '>': '&' + 'gt;',
        '"': '&' + 'quot;',
        "'": '&' + '#39;'
    }[c]));
}

function shortDeviceId(id) {
    if (!id) return '-';
    return id.length > 18 ? escapeHtml(id.slice(0, 8) + '…' + id.slice(-6)) : escapeHtml(id);
}

export async function refreshKioskDevices() {
    const body = document.getElementById('kiosk-devices-body');
    if (!body) return;
    showSkeleton('kiosk-devices-body', 10);

    const filter = document.getElementById('kiosk-devices-filter')?.value || '';
    try {
        const url = filter ? `/api/kiosk-devices?status=${encodeURIComponent(filter)}` : '/api/kiosk-devices';
        const res = await fetch(url);
        if (res.status === 401 || res.status === 403) {
            body.innerHTML = '<tr><td colspan="8" style="text-align:center;">Access denied. Super Admin required.</td></tr>';
            return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to load kiosk devices');

        const list = data.data?.list || [];
        document.getElementById('kiosk-devices-total').innerText = data.data?.total ?? list.length;
        document.getElementById('kiosk-devices-info').innerText = `Showing ${list.length} of ${data.data?.total ?? list.length} devices`;

        if (list.length === 0) {
            body.innerHTML = '<tr><td colspan="8" style="text-align:center;">No kiosk devices found. Devices register automatically on first login attempt and appear here as <strong>Pending</strong>.</td></tr>';
            return;
        }

        body.innerHTML = list.map(dev => buildRowHtml(dev)).join('');
    } catch (err) {
        console.error('refreshKioskDevices error:', err);
        body.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--error);">${escapeHtml(err.message)}</td></tr>`;
    }
}

function buildRowHtml(dev) {
    const meta = STATUS_META[dev.status] || STATUS_META.pending;
    const id = Number(dev.id);
    const bound = dev.bound_username ? escapeHtml(dev.bound_username) : '<span style="color: var(--text-muted);">—</span>';

    // Action dropdown — same pattern as the Employees page.
    let items = '';
    if (dev.status === 'pending' || dev.status === 'revoked') {
        items += `<button class="action-item" onclick="approveKioskDevice(${id})"><i class="fas fa-check-circle"></i> Approve</button>`;
    }
    if (dev.status === 'approved') {
        items += `<button class="action-item" onclick="revokeKioskDevice(${id})"><i class="fas fa-ban"></i> Revoke</button>`;
        items += `<button class="action-item" onclick="unbindKioskDevice(${id})"><i class="fas fa-unlink"></i> Unbind</button>`;
    }
    items += `<button class="action-item" onclick="renameKioskDevice(${id})"><i class="fas fa-pen"></i> Rename</button>`;

    return `
        <tr>
            <td><span class="badge" style="background: ${meta.color}; color: #fff !important;">${meta.label}</span></td>
            <td><code title="${escapeHtml(dev.device_id)}">${shortDeviceId(dev.device_id)}</code></td>
            <td>${escapeHtml(dev.name || '-')}</td>
            <td>${bound}</td>
            <td style="font-size: 0.85rem;">${formatDateTime(dev.first_seen_at)}</td>
            <td style="font-size: 0.85rem;">${formatDateTime(dev.last_seen)}</td>
            <td style="font-size: 0.85rem;">${escapeHtml(dev.approved_by || '-')}</td>
            <td>
                <div class="action-dropdown">
                    <button class="icon-btn" onclick="toggleActions(event, this)" title="Actions">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="action-menu">
                        ${items}
                    </div>
                </div>
            </td>
        </tr>`;
}

/** Load the list of public users to pick from when approving a device. */
async function loadPublicUsers() {
    try {
        const res = await fetch('/auth/users');
        const data = await res.json();
        if (!res.ok) return [];
        const rows = data.data || [];
        const publics = rows.filter(u => u.role === 'public');
        return publics.length > 0 ? publics : rows.filter(u => u.role === 'superadmin');
    } catch (err) {
        console.error('loadPublicUsers error:', err);
        return [];
    }
}

export async function approveKioskDevice(id) {
    const users = await loadPublicUsers();
    if (users.length === 0) {
        showToast('No public account available to bind. Create a user with role "public" first.', 'error');
        return;
    }

    const options = users.map(u =>
        `<option value="${u.id}">${escapeHtml(u.username)} (${escapeHtml(u.role)})</option>`
    ).join('');

    showConfirm({
        title: 'Approve Kiosk Device',
        icon: 'fa-tablet-alt',
        message: `
            <p style="margin-bottom: 1rem;">Approve this device and bind it to a public account.<br>
            <span style="font-size:0.82rem; color:var(--text-muted);">The device can only log in / record attendance as the selected account, and any existing session of that account will be ended.</span></p>
            <label style="display:block; font-size:0.75rem; color:var(--text-muted); margin-bottom:0.4rem; font-weight:600;">BIND TO PUBLIC ACCOUNT</label>
            <select id="kiosk-approve-user" style="width:100%; height:42px; padding:0 1rem; background:rgba(255,255,255,0.06); border:1px solid var(--glass-border); border-radius:0.75rem; color:var(--text);">${options}</select>`,
        confirmText: 'Approve',
        confirmColor: 'var(--success)',
        onConfirm: async () => {
            const userId = Number(document.getElementById('kiosk-approve-user')?.value);
            if (!userId) return showToast('Please select an account', 'warning');
            try {
                const res = await fetch(`/api/kiosk-devices/${id}/approve`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Failed to approve');
                showToast(data.message || 'Kiosk device approved', 'success');
                refreshKioskDevices();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    });
}

export function revokeKioskDevice(id) {
    showConfirm({
        title: 'Revoke Kiosk Device',
        icon: 'fa-ban',
        message: 'Revoke this kiosk device?<br><span style="font-size:0.82rem; color:var(--text-muted);">All active sessions of this device will be force-logged-out immediately and it can no longer record attendance until re-approved.</span>',
        confirmText: 'Revoke',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/kiosk-devices/${id}/revoke`, { method: 'PUT' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Failed to revoke');
                showToast(data.message || 'Kiosk device revoked', 'success');
                refreshKioskDevices();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    });
}

export function unbindKioskDevice(id) {
    showConfirm({
        title: 'Unbind Kiosk Device',
        icon: 'fa-unlink',
        message: 'Unbind this device from its public account?<br><span style="font-size:0.82rem; color:var(--text-muted);">The device returns to <strong>Pending</strong> and its sessions are ended, so it cannot log in until re-approved.</span>',
        confirmText: 'Unbind',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/kiosk-devices/${id}/unbind`, { method: 'PUT' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Failed to unbind');
                showToast(data.message || 'Kiosk device unbound', 'success');
                refreshKioskDevices();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    });
}

export function renameKioskDevice(id) {
    // Use the app modal (same pattern as Devices' add/edit modal) instead of
    // a browser prompt so the UI stays consistent across the dashboard.
    document.getElementById('modal-title').innerText = 'Rename Kiosk Device';
    document.getElementById('modal-content').innerHTML = `
        <div class="form-group">
            <label>Device Name</label>
            <input type="text" id="kiosk-rename-name" placeholder="e.g. Kiosk Lobby">
        </div>
    `;
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = 'Rename';
    saveBtn.style.display = 'block';
    saveBtn.onclick = async () => {
        const name = (document.getElementById('kiosk-rename-name')?.value || '').trim();
        if (!name) return showToast('Name cannot be empty', 'warning');
        try {
            const res = await fetch(`/api/kiosk-devices/${id}/rename`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to rename');
            toggleModal(false);
            showToast(data.message || 'Kiosk device renamed', 'success');
            refreshKioskDevices();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };
    toggleModal(true);
}

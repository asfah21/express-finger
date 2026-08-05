import { state } from '../state.js';
import { showToast, toggleModal, showConfirm } from '../utils.js';
import { showSkeleton } from '../skeleton.js';

export async function refreshDevices() {
    const s = state.pagination.devices;

    // Show skeleton loading
    showSkeleton('devices-body', s.size);

    const res = await fetch(`/api/devices?limit=${s.size}&offset=${s.page * s.size}`);
    const data = await res.json();

    s.total = data.data?.total || 0;
    const body = document.getElementById('devices-body');
    const isAdmin = state.currentUser && (state.currentUser.role === 'admin' || state.currentUser.role === 'superadmin');

    body.innerHTML = (data.data?.list || []).map(dev => `
        <tr>
            <td>
                <span class="badge ${dev.status === 'online' ? 'badge-success' : 'badge-error'}">
                    <i class="fas fa-circle" style="font-size: 0.6rem; margin-right: 4px;"></i>
                    ${dev.status === 'online' ? 'Online' : 'Offline'}
                </span>
            </td>
            <td>${dev.name || 'Unnamed'}</td>
            <td>${dev.ip}</td>
            <td>${dev.sn || '-'}</td>
            <td><span class="badge">${dev.sync_mode || 'HYBRID'}</span></td>
            <td>${dev.is_template_master ? '<span class="badge badge-success"><i class="fas fa-star"></i> Master</span>' : '<span class="badge">Target</span>'}</td>
            <td>
                <div style="font-size: 0.85rem;">
                    <div>Sync: ${dev.last_sync ? new Date(dev.last_sync).toLocaleString() : 'Never'}</div>
                    <div style="color: var(--text-muted); font-size: 0.75rem;">
                        Online: ${dev.last_online ? new Date(dev.last_online).toLocaleString() : 'Never'}
                    </div>
                </div>
            </td>
            <td>
                <div class="action-dropdown">
                    <button class="icon-btn" onclick="toggleActions(event, this)" title="Actions">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="action-menu">
                        <button class="action-item" onclick="syncDevice('${dev.sn}')"><i class="fas fa-sync"></i> Sync Device</button>
                        ${isAdmin ? `
                        <button class="action-item" onclick="toggleTemplateMaster(${dev.id}, ${dev.is_template_master ? 'false' : 'true'})"><i class="fas fa-star"></i> ${dev.is_template_master ? 'Unset Template Master' : 'Set Template Master'}</button>
                        <button class="action-item" onclick="openEditDevice(${dev.id}, '${dev.name || ''}')"><i class="fas fa-edit"></i> Edit Name</button>
                        <button class="action-item delete" onclick="deleteDevice(${dev.id})"><i class="fas fa-trash"></i> Delete</button>
                        ` : ''}
                    </div>
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="8" style="text-align: center;">No devices found</td></tr>';

    window.updatePaginationUI('devices');
}

export async function toggleTemplateMaster(id, enabled) {
    const message = enabled
        ? 'Set this device as the template master? Any existing master will be unset.'
        : 'Unset this device as the template master?';
    showConfirm({
        title: enabled ? 'Set Template Master' : 'Unset Template Master',
        message,
        icon: 'fa-star',
        confirmText: enabled ? 'Set Master' : 'Unset Master',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/devices/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_template_master: enabled })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || data.error || 'Failed to update template master');
                showToast(enabled ? 'Template master set' : 'Template master unset', 'success');
                refreshDevices();
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
    });
}

export async function syncDevice(sn) {
    showToast('Syncing device ' + sn + '...');
    const res = await fetch('/api/sync/device', {
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

export function openAddDevice() {
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

export function openEditDevice(id, currentName) {
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

export async function deleteDevice(id) {
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

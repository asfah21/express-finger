import { state } from '../state.js';
import { showToast, toggleModal, showConfirm, getWitaDateString } from '../utils.js';
import { showSkeleton } from '../skeleton.js';

export async function refreshEmployees() {
    const s = state.pagination.employees;
    const search = document.getElementById('employee-search').value;

    // Show skeleton loading
    showSkeleton('employees-body', s.size);

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
                        <button class="action-item" onclick="syncEmployeeToDevice('${emp.id}')"><i class="fas fa-cloud-upload-alt"></i> Sync to Device</button>
                        <button class="action-item delete" onclick="deleteEmployee('${emp.id}')"><i class="fas fa-trash"></i> Delete</button>
                    </div>
                </div>
                ` : '-'}
            </td>
        </tr>
    `).join('') || '<tr><td colspan="8" style="text-align: center;">No employees found</td></tr>';

    window.updatePaginationUI('employees');
}

/**
 * Sync a single employee to a selected device
 * Shows a device picker modal, then syncs name + user_id to the chosen device
 */
export async function syncEmployeeToDevice(id) {
    // First, get the employee info
    const res = await fetch('/api/employees/' + id);
    const { data: emp } = await res.json();
    if (!emp) return showToast('Employee not found', 'error');

    // Get devices list
    const devRes = await fetch('/api/devices');
    const devData = await devRes.json();
    const devices = devData.data?.list || [];
    if (devices.length === 0) return showToast('No devices available', 'warning');

    // Build device options
    const deviceOptions = devices.map(d => 
        `<option value="${d.id}">${d.name || d.ip} (${d.sn})</option>`
    ).join('');

    // Show modal with device picker
    document.getElementById('modal-title').innerHTML = '<i class="fas fa-cloud-upload-alt" style="margin-right: 0.5rem; color: var(--primary);"></i> Sync to Device';
    document.getElementById('modal-content').innerHTML = `
        <p style="color: var(--text-muted); margin-bottom: 1rem;">
            Sync employee <strong>${emp.nama || 'Unknown'}</strong> (User ID: ${emp.user_id}) to device:
        </p>
        <div class="form-group">
            <label>Select Device</label>
            <select id="sync-device-select">
                <option value="">-- Select Device --</option>
                ${deviceOptions}
            </select>
        </div>
        <div style="margin-top: 0.75rem; padding: 0.75rem; background: rgba(255,255,255,0.04); border-radius: 0.5rem; border: 1px solid var(--glass-border);">
            <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">
                <i class="fas fa-info-circle" style="color: var(--primary);"></i> 
                This will write the employee's name and User ID to the selected fingerprint device.
            </p>
        </div>
    `;

    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.innerText = 'Sync Now';
    saveBtn.style.display = 'block';
    saveBtn.onclick = async () => {
        const deviceId = document.getElementById('sync-device-select').value;
        if (!deviceId) return showToast('Please select a device', 'warning');

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';

        try {
            const syncRes = await fetch('/api/employees/' + id + '/sync-to-device', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId: parseInt(deviceId) })
            });
            const syncData = await syncRes.json();

            if (syncRes.ok && syncData.status === 'success') {
                showToast(syncData.message || 'Sync successful!', 'success');
                toggleModal(false);
            } else {
                throw new Error(syncData.message || 'Sync failed');
            }
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = 'Sync Now';
        }
    };

    toggleModal(true);
}


let empSearchTimer;
export function handleEmployeeSearch(val) {
    clearTimeout(empSearchTimer);
    empSearchTimer = setTimeout(() => {
        if (val.length >= 3 || val.length === 0) {
            state.pagination.employees.page = 0;
            refreshEmployees();
        }
    }, 600);
}

export async function editEmployee(id) {
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

export async function deleteEmployee(id) {
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

export function openAddEmployee() {
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

    if (!data.user_id) return showToast('User ID is required', 'warning');

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
        const err = await res.json();
        showToast(err.message || 'Failed to add employee', 'error');
    }
}

export async function exportEmployees() {
    try {
        const res = await fetch(`/api/employees?limit=${state.EXPORT_LIMIT}`);
        const data = await res.json();
        const employees = data.data?.list || [];

        const cleanedEmployees = employees.map(emp => {
            const { id, created_at, updated_at, ...rest } = emp;
            return rest;
        });

        const worksheet = XLSX.utils.json_to_sheet(cleanedEmployees);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Employees");

        XLSX.writeFile(workbook, `employees_export_${getWitaDateString()}.xlsx`);
        showToast('Export successful');
        // window.recordClientActivity is still global or accessible
        if (window.recordClientActivity) {
            await window.recordClientActivity('export_employees', 'export', `Exported ${employees.length} employees to Excel`);
        }
    } catch (err) {
        showToast('Export failed', 'error');
    }
}

export function showImportModal() {
    toggleModal(true);
    document.getElementById('modal-title').innerText = 'Import Employees';
    document.getElementById('modal-content').innerHTML = `
        <div style="text-align: center; margin-bottom: 2rem;">
            <i class="fas fa-file-excel" style="font-size: 3.5rem; color: var(--success); margin-bottom: 1rem;"></i>
            <p style="color: var(--text-muted); margin-bottom: 1.5rem;">Please download the template below, fill in your employee data, and then use the upload button to import.</p>
            
            <button class="btn-primary" id="btn-download-template" style="background: rgba(119, 160, 68, 0.15); color: var(--secondary); border: 1px solid var(--secondary); box-shadow: none; width: auto; margin-bottom: 0.5rem;">
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
    
    document.getElementById('btn-download-template').onclick = downloadImportTemplate;
    
    const saveBtn = document.getElementById('modal-save-btn');
    saveBtn.style.display = 'none';
}

export function downloadImportTemplate() {
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

export function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    toggleModal(false); 
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

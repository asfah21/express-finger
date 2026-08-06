import { state } from '../state.js'
import { showToast, toggleModal, showConfirm } from '../utils.js'

let employees = []
let templates = []

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))
}

function employeeOptions(selected = '') {
    return employees.map(emp => `<option value="${escapeHtml(emp.user_id)}" ${String(emp.user_id) === String(selected) ? 'selected' : ''}>${escapeHtml(emp.nama || 'Unnamed')} — ${escapeHtml(emp.user_id)}</option>`).join('')
}

async function request(path, options = {}) {
    const res = await fetch(path, options)
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.status === 'error') throw new Error(data.message || 'Biometric request failed')
    return data.data
}

export async function refreshBiometrics() {
    try {
        const data = await request('/api/employees?limit=500&offset=0')
        employees = data?.list || []
        const select = document.getElementById('biometric-employee-select')
        const modalSelect = document.getElementById('biometric-modal-employee')
        const current = select?.value || ''
        if (select) select.innerHTML = '<option value="">-- Select Employee --</option>' + employeeOptions(current)
        if (modalSelect) modalSelect.innerHTML = '<option value="">-- Select Employee --</option>' + employeeOptions(current)
        if (current) await loadBiometricTemplates()
    } catch (error) {
        showToast(error.message, 'error')
    }
}

export async function loadBiometricTemplates() {
    const userId = document.getElementById('biometric-employee-select')?.value
    if (!userId) {
        templates = []
        renderTemplates()
        return
    }
    try {
        templates = await request(`/api/biometrics?userId=${encodeURIComponent(userId)}`) || []
        renderTemplates()
    } catch (error) {
        showToast(error.message, 'error')
    }
}

function renderTemplates() {
    const body = document.getElementById('biometrics-body')
    const fp = templates.filter(item => item.template_type === 'fingerprint').length
    const face = templates.filter(item => item.template_type === 'face').length
    document.getElementById('biometric-fingerprint-count').textContent = fp
    document.getElementById('biometric-face-count').textContent = face
    if (!body) return
    if (!templates.length) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:2rem;">No templates stored for this employee.</td></tr>'
        return
    }
    body.innerHTML = templates.map(item => `<tr>
        <td><span class="badge" style="background:${item.template_type === 'face' ? 'rgba(119,160,68,.18)' : 'rgba(36,97,150,.18)'};">${escapeHtml(item.template_type)}</span></td>
        <td>${item.template_index}</td><td>${item.size} bytes</td>
        <td><code title="${escapeHtml(item.checksum)}">${escapeHtml(item.checksum.slice(0, 16))}…</code></td>
        <td>${escapeHtml(item.payload_format)}</td><td>${escapeHtml(item.metadata?.source || (item.source_device_sn ? `Device ${item.source_device_sn}` : 'Manual'))}</td>
        <td>${item.captured_at ? new Date(item.captured_at).toLocaleString('id-ID') : '-'}</td>
        <td><div style="display:flex;gap:.35rem;"><button class="icon-btn" title="Download base64" onclick="downloadBiometricTemplate('${item.id}')"><i class="fas fa-download"></i></button><button class="icon-btn" title="Delete template" onclick="deleteBiometricTemplate('${item.id}')"><i class="fas fa-trash"></i></button></div></td>
    </tr>`).join('')
}

export function openBiometricModal() {
    const content = document.getElementById('biometric-modal-content')
    const selected = document.getElementById('biometric-employee-select')?.value || ''
    document.getElementById('modal-title').innerHTML = '<i class="fas fa-fingerprint" style="color:var(--secondary);margin-right:.5rem;"></i> Add Biometric Template'
    document.getElementById('modal-content').innerHTML = content?.innerHTML || ''
    const modalSelect = document.getElementById('biometric-modal-employee')
    if (modalSelect) modalSelect.innerHTML = '<option value="">-- Select Employee --</option>' + employeeOptions(selected)
    const saveBtn = document.getElementById('modal-save-btn')
    saveBtn.style.display = 'block'; saveBtn.textContent = 'Save Template'; saveBtn.style.background = 'var(--secondary)'; saveBtn.onclick = saveBiometricTemplate
    toggleModal(true)
}

async function fileToBase64(file) {
    const buffer = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
}

export async function saveBiometricTemplate() {
    const employee = document.getElementById('biometric-modal-employee')?.value
    const type = document.getElementById('biometric-modal-type')?.value
    const index = Number(document.getElementById('biometric-modal-index')?.value)
    const file = document.getElementById('biometric-modal-file')?.files?.[0]
    let base64 = document.getElementById('biometric-modal-base64')?.value?.trim() || ''
    if (!employee) return showToast('Please select an employee', 'warning')
    if (!Number.isInteger(index) || index < 0 || index > 255) return showToast('Template index must be between 0 and 255', 'warning')
    if (file) base64 = await fileToBase64(file)
    if (!base64) return showToast('Choose a template file or paste base64 data', 'warning')
    const saveBtn = document.getElementById('modal-save-btn'); saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'
    try {
        await request('/api/biometrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: employee, templateType: type, templateIndex: index, base64, originalFilename: file?.name || '' }) })
        toggleModal(false); document.getElementById('biometric-employee-select').value = employee; await loadBiometricTemplates(); showToast('Biometric template saved', 'success')
    } catch (error) { showToast(error.message, 'error') } finally { saveBtn.disabled = false; saveBtn.textContent = 'Save Template' }
}

export function deleteBiometricTemplate(id) {
    showConfirm({
        title: 'Delete Biometric Template', message: 'The current record will be invalidated. Existing history remains preserved.', icon: 'fa-trash', confirmText: 'Delete', confirmColor: 'var(--error)', onConfirm: async () => {
            try { await request(`/api/biometrics/${id}`, { method: 'DELETE' }); await loadBiometricTemplates(); showToast('Biometric template deleted', 'success') } catch (error) { showToast(error.message, 'error') }
        }
    })
}

export async function downloadBiometricTemplate(id) {
    try {
        const data = await request(`/api/biometrics/${id}/download`)
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `biometric-template-${id}.json`; link.click(); URL.revokeObjectURL(link.href)
        showToast('Template backup downloaded', 'success')
    } catch (error) { showToast(error.message, 'error') }
}

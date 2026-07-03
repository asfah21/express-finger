import { state } from '../state.js';
import { showToast } from '../utils.js';

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

/**
 * Switch between HR settings tabs
 */
export function switchHrTab(tabId) {
    // Update tab button active states
    document.querySelectorAll('.hr-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    // Update tab panel active states
    document.querySelectorAll('.hr-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === 'hr-tab-' + tabId);
    });
}
window.switchHrTab = switchHrTab;

export async function loadHrSettings() {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.status === 'success') {
        const s = data.data;
        document.getElementById('hr-late-tolerance').value = s.late_tolerance_mins || 5;

        // Remarks config
        const r = s.remarks_config || {};
        document.getElementById('hr-remark-late').value = r.late || '';
        document.getElementById('hr-remark-early-arrival').value = r.early_arrival || '';
        document.getElementById('hr-remark-early-departure').value = r.early_departure || '';
        document.getElementById('hr-remark-overtime').value = r.overtime_check || '';
        document.getElementById('hr-remark-duplicate').value = r.duplicate || '';

        // Shifts config
        document.getElementById('hr-shift-types').value = JSON.stringify(s.shift_types || {}, null, 4);
    }
}

export async function saveHrAttendanceSettings() {
    const lateTolerance = document.getElementById('hr-late-tolerance').value;
    await updateSettings({
        late_tolerance_mins: parseInt(lateTolerance)
    }, 'Attendance rules updated');
}

export async function saveHrRemarksSettings() {
    const payload = {
        remarks_config: {
            late: document.getElementById('hr-remark-late').value,
            early_arrival: document.getElementById('hr-remark-early-arrival').value,
            early_departure: document.getElementById('hr-remark-early-departure').value,
            overtime_check: document.getElementById('hr-remark-overtime').value,
            duplicate: document.getElementById('hr-remark-duplicate').value
        }
    };
    await updateSettings(payload, 'Attendance remarks updated');
}

export async function saveHrShiftSettings() {
    try {
        const jsonStr = document.getElementById('hr-shift-types').value;
        const shiftTypes = JSON.parse(jsonStr);
        await updateSettings({ shift_types: shiftTypes }, 'Shift configurations updated');
    } catch (err) {
        showToast('Invalid JSON format for Shift Config', 'error');
    }
}

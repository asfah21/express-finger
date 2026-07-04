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
    // Update tab button active states with matching colors
    document.querySelectorAll('.hr-tab').forEach(tab => {
        const isActive = tab.dataset.tab === tabId;
        tab.classList.toggle('active', isActive);
        if (isActive) {
            const color = tab.dataset.color || 'var(--primary)';
            tab.style.setProperty('--tab-active-color', color);
        }
    });
    // Update tab panel active states
    document.querySelectorAll('.hr-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === 'hr-tab-' + tabId);
    });
}
window.switchHrTab = switchHrTab;


export async function loadHrSettings() {
    // Set initial active tab color
    const activeTab = document.querySelector('.hr-tab.active');
    if (activeTab) {
        const color = activeTab.dataset.color || 'var(--primary)';
        activeTab.style.setProperty('--tab-active-color', color);
    }

    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.status === 'success') {
        const s = data.data;
        document.getElementById('hr-late-tolerance').value = s.late_tolerance_mins || 5;

        // Rule In Out config
        const ruleInOut = s.rule_in_out || {};
        const setTime = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        setTime('hr-rule-day-checkin-start', ruleInOut.day_checkin?.[0] || '05:00');
        setTime('hr-rule-day-checkin-end', ruleInOut.day_checkin?.[1] || '10:00');
        setTime('hr-rule-night-checkin-start', ruleInOut.night_checkin?.[0] || '17:00');
        setTime('hr-rule-night-checkin-end', ruleInOut.night_checkin?.[1] || '22:00');
        setTime('hr-rule-day-checkout-start', ruleInOut.day_checkout?.[0] || '17:00');
        setTime('hr-rule-day-checkout-end', ruleInOut.day_checkout?.[1] || '20:00');
        setTime('hr-rule-night-checkout-start', ruleInOut.night_checkout?.[0] || '23:00');
        setTime('hr-rule-night-checkout-end', ruleInOut.night_checkout?.[1] || '08:00');

        // Remarks config
        const remarksCfg = s.remarks_config || {};
        document.getElementById('hr-remark-late').value = remarksCfg.late || '';
        document.getElementById('hr-remark-early-arrival').value = remarksCfg.early_arrival || '';
        document.getElementById('hr-remark-early-departure').value = remarksCfg.early_departure || '';
        document.getElementById('hr-remark-overtime').value = remarksCfg.overtime_check || '';
        document.getElementById('hr-remark-duplicate').value = remarksCfg.duplicate || '';
        document.getElementById('hr-remark-anomaly-masuk').value = remarksCfg.anomaly_masuk || '';
        document.getElementById('hr-remark-anomaly-pulang').value = remarksCfg.anomaly_pulang || '';

        // Shifts config
        document.getElementById('hr-shift-types').value = JSON.stringify(s.shift_types || {}, null, 4);
    }
}

export async function saveHrAttendanceSettings() {
    const lateTolerance = document.getElementById('hr-late-tolerance').value;
    const getVal = (id) => document.getElementById(id)?.value || '';
    const ruleInOut = {
        day_checkin: [getVal('hr-rule-day-checkin-start'), getVal('hr-rule-day-checkin-end')],
        night_checkin: [getVal('hr-rule-night-checkin-start'), getVal('hr-rule-night-checkin-end')],
        day_checkout: [getVal('hr-rule-day-checkout-start'), getVal('hr-rule-day-checkout-end')],
        night_checkout: [getVal('hr-rule-night-checkout-start'), getVal('hr-rule-night-checkout-end')]
    };
    await updateSettings({
        late_tolerance_mins: parseInt(lateTolerance),
        rule_in_out: ruleInOut
    }, 'Rules updated');
}

export async function saveHrRemarksSettings() {
    const payload = {
        remarks_config: {
            late: document.getElementById('hr-remark-late').value,
            early_arrival: document.getElementById('hr-remark-early-arrival').value,
            early_departure: document.getElementById('hr-remark-early-departure').value,
            overtime_check: document.getElementById('hr-remark-overtime').value,
            duplicate: document.getElementById('hr-remark-duplicate').value,
            anomaly_masuk: document.getElementById('hr-remark-anomaly-masuk').value,
            anomaly_pulang: document.getElementById('hr-remark-anomaly-pulang').value
        }
    };
    await updateSettings(payload, 'Remarks updated');
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

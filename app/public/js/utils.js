/**
 * Common utility functions for the application
 */

export const BUSINESS_TIME_ZONE = 'Asia/Makassar';

export function getWitaDateString() {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Makassar',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
    } catch (e) {
        const now = new Date();
        const wita = new Date(now.getTime() + (8 * 60 * 60 * 1000));
        return wita.toISOString().split('T')[0];
    }
}

export function getBusinessTimeParts(value) {
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: BUSINESS_TIME_ZONE,
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(new Date(value)).reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {});
}

/**
 * Read the stored attendance timestamp the same way the Attendance Log page does.
 * Rows are persisted with the business (WITA) wall-clock time already stored as a
 * UTC value (e.g. live camera writes `now() + interval '8 hours'`), so reading the
 * UTC calendar fields directly avoids applying a second +08:00 conversion.
 */
export function getUtcTimestampParts(value) {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) {
        return { year: '-', month: '-', day: '-', hour: '--', minute: '--', second: '--' };
    }
    return {
        year: String(dt.getUTCFullYear()),
        month: String(dt.getUTCMonth() + 1).padStart(2, '0'),
        day: String(dt.getUTCDate()).padStart(2, '0'),
        hour: String(dt.getUTCHours()).padStart(2, '0'),
        minute: String(dt.getUTCMinutes()).padStart(2, '0'),
        second: String(dt.getUTCSeconds()).padStart(2, '0')
    };
}

export function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    if (!toast || !msgEl) return;

    msgEl.innerText = message;

    // Set color based on type
    let color = 'var(--glass-border)';
    if (type === 'error') color = 'var(--error)';
    if (type === 'success') color = 'var(--success)';
    if (type === 'warning') color = 'var(--warning)';

    toast.style.borderColor = color;
    toast.classList.add('active');

    setTimeout(() => {
        toast.classList.remove('active');
    }, 3000);
}

export function toggleModal(show) {
    const modal = document.getElementById('modal-overlay');
    if (!modal) return;

    if (show) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    } else {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
    }
}

export function showConfirm({ title, message, icon, confirmText, confirmColor, onConfirm, onCancel }) {
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');
    const saveBtn = document.getElementById('modal-save-btn');
    const cancelBtn = document.querySelector('#modal-overlay .modal .btn-secondary');

    modalTitle.innerText = title || 'Confirm Action';
    modalContent.innerHTML = `
        <div style="text-align: center; margin-bottom: 1.5rem;">
            <i class="fas ${icon || 'fa-question-circle'}" style="font-size: 3.5rem; color: ${confirmColor || 'var(--primary)'}; margin-bottom: 1rem; opacity: 0.9;"></i>
            <p style="font-size: 1.05rem; line-height: 1.5; color: var(--text);">${message}</p>
        </div>
    `;

    saveBtn.innerText = confirmText || 'Confirm';
    saveBtn.style.display = 'block';
    saveBtn.style.background = confirmColor || 'var(--primary)';

    // Remove previous event listeners by cloning and replacing
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.onclick = () => {
        if (onConfirm) onConfirm();
        toggleModal(false);
    };

    // Override cancel button to call onCancel
    if (cancelBtn) {
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        newCancelBtn.onclick = (e) => {
            if (onCancel) {
                onCancel();
            }
            toggleModal(false);
        };
    }

    toggleModal(true);
}

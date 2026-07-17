/**
 * Common utility functions for the application
 */

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

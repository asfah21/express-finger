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
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';
    if (type === 'warning') icon = 'fa-exclamation-triangle';
    
    toast.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }, 100);
}

export function toggleModal(show) {
    const modal = document.getElementById('modal-overlay');
    if (show) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    } else {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

export function showConfirm({ title, message, icon, confirmText, confirmColor, onConfirm }) {
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');
    const saveBtn = document.getElementById('modal-save-btn');

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
    
    saveBtn.onclick = () => {
        onConfirm();
        toggleModal(false);
    };

    toggleModal(true);
}

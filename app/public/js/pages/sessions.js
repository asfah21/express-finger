import { state } from '../state.js';
import { showToast, showConfirm } from '../utils.js';
import { showSkeleton } from '../skeleton.js';

const BUSINESS_TIME_ZONE = 'Asia/Makassar';

const STATUS_META = {
    online: { label: 'Online', color: '#10b981' },
    away: { label: 'Away', color: '#f59e0b' },
    idle: { label: 'Idle', color: 'rgba(255,255,255,0.3)' },
    expired: { label: 'Expired', color: '#ef4444' },
    ended: { label: 'Ended', color: 'rgba(255,255,255,0.2)' },
    unknown: { label: 'Unknown', color: 'rgba(255,255,255,0.2)' },
};

function formatDateTime(value) {
    if (!value) return '-';
    try {
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: BUSINESS_TIME_ZONE,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
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

let sessionSearchTimer;

export function handleSessionSearch(val) {
    clearTimeout(sessionSearchTimer);
    sessionSearchTimer = setTimeout(() => {
        if (val.length >= 3 || val.length === 0) {
            state.pagination.sessions.page = 0;
            refreshSessions();
        }
    }, 600);
}

export async function refreshSessions() {
    const s = state.pagination.sessions;
    const body = document.getElementById('sessions-body');
    if (!body) return;

    const search = document.getElementById('session-search')?.value || '';
    showSkeleton('sessions-body', Math.min(s.size, 10));

    let url = `/api/sessions?limit=${s.size}&offset=${s.page * s.size}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    try {
        const res = await fetch(url);
        if (res.status === 401 || res.status === 403) {
            body.innerHTML = '<tr><td colspan="8" style="text-align: center;">Access denied or session ended. Please refresh.</td></tr>';
            window.updatePaginationUI('sessions');
            return;
        }
        const data = await res.json();
        const d = data.data || {};
        s.total = d.total || 0;

        const currentJti = d.current_jti || null;

        const onlineEl = document.getElementById('sessions-online-count');
        const activeEl = document.getElementById('sessions-active-count');
        if (onlineEl) onlineEl.innerText = d.online ?? 0;
        if (activeEl) activeEl.innerText = d.active ?? 0;

        body.innerHTML = (d.list || []).map(sess => {
            const meta = STATUS_META[sess.status] || STATUS_META.unknown;
            const isSelf = sess.jti === currentJti;
            const canKill = !isSelf && sess.status !== 'ended' && sess.status !== 'expired';
            const user = escapeHtml(sess.username);
            const safeUser = user.replace(/'/g, "\\'");

            return `
            <tr>
                <td>
                    <span class="badge" style="background: ${meta.color}; color: #fff !important;">${meta.label}${isSelf ? ' · You' : ''}</span>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <i class="fas fa-user-circle" style="color: var(--primary);"></i>
                        <span>${user}${isSelf ? ' <span style="font-size: 0.72rem; color: var(--text-muted);">(current)</span>' : ''}</span>
                    </div>
                </td>
                <td><span class="badge" style="background: rgba(255,255,255,0.1);">${sess.role || '-'}</span></td>
                <td style="font-size: 0.85rem;">${sess.ip_address || '-'}</td>
                <td style="font-size: 0.85rem;">${formatDateTime(sess.created_at)}</td>
                <td style="font-size: 0.85rem;">${formatDateTime(sess.last_seen)}</td>
                <td style="font-size: 0.85rem;">${formatDateTime(sess.expires_at)}</td>
                <td>
                    ${canKill ? `
                    <div class="action-dropdown">
                        <button class="icon-btn" onclick="toggleActions(event, this)" title="Actions">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                        <div class="action-menu">
                            <button class="action-item" onclick="killSession('${sess.jti}', '${safeUser}')">
                                <i class="fas fa-sign-out-alt"></i> End Session
                            </button>
                            <button class="action-item delete" onclick="killAllUserSessions(${sess.user_id}, '${safeUser}')">
                                <i class="fas fa-user-slash"></i> End All Sessions
                            </button>
                        </div>
                    </div>` : '<span style="font-size: 0.75rem; color: var(--text-muted);">—</span>'}
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="8" style="text-align: center;">No sessions found</td></tr>';

        window.updatePaginationUI('sessions');
    } catch (err) {
        console.error('refreshSessions error:', err);
        body.innerHTML = '<tr><td colspan="8" style="text-align: center;">Failed to load sessions</td></tr>';
        window.updatePaginationUI('sessions');
    }
}

export function killSession(jti, username) {
    showConfirm({
        title: 'End Session',
        message: `Force-logout the session for <strong>${username}</strong>?<br><span style="font-size: 0.85rem; color: var(--text-muted);">The user will be signed out immediately.</span>`,
        icon: 'fa-sign-out-alt',
        confirmText: 'End Session',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/sessions/${encodeURIComponent(jti)}/kill`, { method: 'POST' });
                const data = await res.json();
                if (res.ok) {
                    showToast(data.message || 'Session ended', 'success');
                    refreshSessions();
                } else {
                    showToast(data.message || 'Failed to end session', 'error');
                }
            } catch (err) {
                showToast('Network error', 'error');
            }
        }
    });
}

export function killAllUserSessions(userId, username) {
    showConfirm({
        title: 'End All Sessions',
        message: `Force-logout <strong>all</strong> active sessions for <strong>${username}</strong>?<br><span style="font-size: 0.85rem; color: var(--text-muted);">Every device where this user is signed in will be logged out.</span>`,
        icon: 'fa-user-slash',
        confirmText: 'End All Sessions',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/sessions/user/${userId}/kill`, { method: 'POST' });
                const data = await res.json();
                if (res.ok) {
                    showToast(data.message || 'All sessions ended', 'success');
                    refreshSessions();
                } else {
                    showToast(data.message || 'Failed to end sessions', 'error');
                }
            } catch (err) {
                showToast('Network error', 'error');
            }
        }
    });
}

export function killOtherSessions() {
    showConfirm({
        title: 'End Other Sessions',
        message: 'Force-logout <strong>all other</strong> active sessions except your current one?<br><span style="font-size: 0.85rem; color: var(--text-muted);">Every other admin/viewer currently signed in will be logged out.</span>',
        icon: 'fa-user-slash',
        confirmText: 'End Others',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            try {
                const res = await fetch('/api/sessions/kill-others', { method: 'POST' });
                const data = await res.json();
                if (res.ok) {
                    showToast(data.message || 'Other sessions ended', 'success');
                    refreshSessions();
                } else {
                    showToast(data.message || 'Failed to end sessions', 'error');
                }
            } catch (err) {
                showToast('Network error', 'error');
            }
        }
    });
}

// Auto-refresh the sessions table every 10s while the page is visible,
// so "online" status stays real-time.
let sessionAutoRefreshTimer = null;

export function startSessionAutoRefresh() {
    if (sessionAutoRefreshTimer) return;
    sessionAutoRefreshTimer = setInterval(() => {
        if (state.currentUser?.role === 'superadmin' && state.currentPath === 'sessions' && !document.hidden) {
            refreshSessions();
        }
    }, 10000);
}

export function stopSessionAutoRefresh() {
    if (sessionAutoRefreshTimer) {
        clearInterval(sessionAutoRefreshTimer);
        sessionAutoRefreshTimer = null;
    }
}

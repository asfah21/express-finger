import { state } from './state.js';
import { showToast, showConfirm } from './utils.js';
import { deviceHeaders, kioskDeviceErrorMessage } from './device.js';

export async function checkAuth() {
    try {
        const response = await fetch('/auth/me');
        if (response.ok) {
            const data = await response.json();
            state.currentUser = data.data.user;
            window.showDashboard();
            startSessionHeartbeat();
        } else {
            // Check if this is a fresh install (no users yet) to show default credentials
            try {
                const infoRes = await fetch('/auth/check-default');
                if (infoRes.ok) {
                    const infoData = await infoRes.json();
                    if (infoData.data?.isDefaultOnly) {
                        const infoEl = document.getElementById('login-info');
                        const infoText = document.getElementById('login-info-text');
                        if (infoEl && infoText) {
                            infoText.innerHTML = `Default credentials: <strong>superadmin</strong> / <strong>admin123</strong><br>Please change password after login.`;
                            infoEl.style.display = 'block';
                        }
                    }
                }
            } catch (_) {}
            window.showLogin();
        }
    } catch (err) {
        window.showLogin();
    }
}

// Token check dengan tolerance - jangan logout langsung jika network glitch
// Hanya logout jika 3 kali berturut-turut gagal (bukan 1 kali)
let tokenCheckFailCount = 0;
const TOKEN_CHECK_MAX_FAIL = 3;

export async function silentTokenCheck() {
    if (!state.currentUser) return;
    try {
        const response = await fetch('/auth/me');
        if (!response.ok) {
            if (response.status === 401) {
                // Definitive auth failure — the session was revoked (force logout)
                // or the token expired. Log out immediately instead of waiting
                // for the 3-fail tolerance (which exists for network glitches only).
                console.warn('Session rejected by server (401). Logging out.');
                stopSessionHeartbeat();
                state.currentUser = null;
                window.showLogin();
                return;
            }
            tokenCheckFailCount++;
            console.warn(`Auth check failed (${tokenCheckFailCount}/${TOKEN_CHECK_MAX_FAIL}): ${response.status}`);
            if (tokenCheckFailCount >= TOKEN_CHECK_MAX_FAIL) {
                console.warn('Token check failed 3 times, logging out.');
                stopSessionHeartbeat();
                state.currentUser = null;
                window.showLogin();
            }
        } else {
            // Reset fail count on success
            tokenCheckFailCount = 0;
        }
    } catch (err) {
        tokenCheckFailCount++;
        console.warn(`Auth check network error (${tokenCheckFailCount}/${TOKEN_CHECK_MAX_FAIL}):`, err.message);
        if (tokenCheckFailCount >= TOKEN_CHECK_MAX_FAIL) {
            console.warn('Token check failed 3 times (network), logging out.');
            stopSessionHeartbeat();
            state.currentUser = null;
            window.showLogin();
        }
    }
}

// ============================================================
// Session heartbeat — keeps last_seen fresh and lets the server
// force-logout an active browser within ~30 seconds.
// ============================================================
const HEARTBEAT_INTERVAL_MS = 30000; // 30s
let heartbeatInterval = null;

export function startSessionHeartbeat() {
    if (heartbeatInterval) return;
    heartbeatInterval = setInterval(async () => {
        if (!state.currentUser) return;
        try {
            const res = await fetch('/api/sessions/heartbeat', { method: 'POST', headers: deviceHeaders() });
            if (res.status === 401) {
                // Session was revoked (force-logout) or expired → log out now.
                console.warn('Heartbeat rejected (401) — session ended by server.');
                stopSessionHeartbeat();
                state.currentUser = null;
                window.showLogin();
                showToast('Your session has been ended by an administrator', 'warning');
            } else if (res.status === 403) {
                // Kiosk device gate rejected the heartbeat (revoked / pending /
                // unbound). Read the code and log the kiosk out with a clear message.
                const body = await res.json().catch(() => ({}));
                const msg = kioskDeviceErrorMessage(body.code) || 'Akses perangkat kiosk ditolak';
                console.warn('Heartbeat rejected (403 kiosk device):', body.code || body.message);
                stopSessionHeartbeat();
                state.currentUser = null;
                window.showLogin();
                showToast(msg, 'error');
            }
        } catch (err) {
            // Network error — ignore; silentTokenCheck handles persistent failures.
        }
    }, HEARTBEAT_INTERVAL_MS);
}

export function stopSessionHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// Prevent double submit login
let isLoggingIn = false;

export async function handleLogin(e) {
    e.preventDefault();
    
    // Prevent double submit
    if (isLoggingIn) return;
    isLoggingIn = true;
    
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    const error = document.getElementById('login-error');

    btn.disabled = true;
    btn.innerText = 'Signing in...';
    error.style.display = 'none';

    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...deviceHeaders() },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (response.ok) {
            state.currentUser = data.data.user;
            window.showDashboard();
            startSessionHeartbeat();
            showToast('Welcome back, ' + state.currentUser.username);
        } else {
            // Kiosk device gate errors get a friendly, specific message.
            const friendly = kioskDeviceErrorMessage(data.code);
            error.innerText = friendly || data.message || 'Login failed';
            error.style.display = 'block';
        }
    } catch (err) {
        error.innerText = 'Network error occurred';
        error.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerText = 'Sign In';
        isLoggingIn = false;
    }
}

export async function logout() {
    showConfirm({
        title: 'Logout',
        message: 'Are you sure you want to logout?',
        icon: 'fa-sign-out-alt',
        confirmText: 'Logout',
        confirmColor: 'var(--error)',
        onConfirm: async () => {
            stopSessionHeartbeat();
            try {
                await fetch('/auth/logout', { method: 'POST' });
            } catch (_) { /* ignore network errors on logout */ }
            state.currentUser = null;
            window.showLogin();
        }
    });
}

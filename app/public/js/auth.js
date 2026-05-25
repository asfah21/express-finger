import { state } from './state.js';
import { showToast, showConfirm } from './utils.js';

export async function checkAuth() {
    try {
        const response = await fetch('/auth/me');
        if (response.ok) {
            const data = await response.json();
            state.currentUser = data.data.user;
            window.showDashboard();
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
            tokenCheckFailCount++;
            console.warn(`Auth check failed (${tokenCheckFailCount}/${TOKEN_CHECK_MAX_FAIL}): ${response.status}`);
            if (tokenCheckFailCount >= TOKEN_CHECK_MAX_FAIL) {
                console.warn('Token check failed 3 times, logging out.');
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
            state.currentUser = null;
            window.showLogin();
        }
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (response.ok) {
            state.currentUser = data.data.user;
            window.showDashboard();
            showToast('Welcome back, ' + state.currentUser.username);
        } else {
            error.innerText = data.message || 'Login failed';
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
            try {
                await fetch('/auth/logout', { method: 'POST' });
            } catch (_) { /* ignore network errors on logout */ }
            state.currentUser = null;
            window.showLogin();
        }
    });
}

import { state } from './state.js';
import { showToast } from './utils.js';

export async function checkAuth() {
    try {
        const response = await fetch('/auth/me');
        if (response.ok) {
            const data = await response.json();
            state.currentUser = data.data.user;
            window.showDashboard();
        } else {
            window.showLogin();
        }
    } catch (err) {
        window.showLogin();
    }
}

export async function silentTokenCheck() {
    if (!state.currentUser) return;
    try {
        const response = await fetch('/auth/me');
        if (!response.ok) {
            state.currentUser = null;
            window.showLogin();
        }
    } catch (err) {
        console.warn('Auth check failed (network?), will retry later.');
    }
}

export async function handleLogin(e) {
    e.preventDefault();
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
    }
}

export async function logout() {
    await fetch('/auth/logout', { method: 'POST' });
    state.currentUser = null;
    window.showLogin();
}

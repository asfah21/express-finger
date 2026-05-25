import { showToast } from '../utils.js';

export async function refreshCacheMetrics() {
    const hitsEl = document.getElementById('metric-hits');
    const missesEl = document.getElementById('metric-misses');
    const hitrateEl = document.getElementById('metric-hitrate');
    const sizeEl = document.getElementById('metric-size');
    const utilizationEl = document.getElementById('metric-utilization');
    const setsEl = document.getElementById('metric-sets');
    const deletesEl = document.getElementById('metric-deletes');
    const totalEl = document.getElementById('metric-total');
    const keysBody = document.getElementById('metric-keys-body');
    const keyCountEl = document.getElementById('metric-key-count');

    // Show loading state
    if (keysBody) {
        keysBody.innerHTML = `
            <tr>
                <td colspan="2" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                    <i class="fas fa-spinner fa-spin"></i> Loading cache keys...
                </td>
            </tr>
        `;
    }

    try {
        const res = await fetch('/api/cache-stats');
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.message || 'Failed to fetch cache stats');
        }
        const data = await res.json();

        if (data.status === 'ok' && data.cache) {
            const c = data.cache;

            // Update stat cards
            if (hitsEl) hitsEl.textContent = c.hits?.toLocaleString() || '0';
            if (missesEl) missesEl.textContent = c.misses?.toLocaleString() || '0';
            if (hitrateEl) hitrateEl.textContent = (c.hitRate !== undefined ? c.hitRate : '0') + '%';
            if (sizeEl) sizeEl.textContent = `${c.size || 0} / ${c.maxSize || 0}`;
            if (utilizationEl) utilizationEl.textContent = c.utilization || '0%';
            if (setsEl) setsEl.textContent = c.sets?.toLocaleString() || '0';
            if (deletesEl) deletesEl.textContent = c.deletes?.toLocaleString() || '0';
            if (totalEl) totalEl.textContent = c.total?.toLocaleString() || '0';

            // Update keys table
            const keys = c.keys || [];
            if (keyCountEl) keyCountEl.textContent = `${keys.length} keys`;

            if (keysBody) {
                if (keys.length === 0) {
                    keysBody.innerHTML = `
                        <tr>
                            <td colspan="2" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                                <i class="fas fa-inbox"></i> No cache keys
                            </td>
                        </tr>
                    `;
                } else {
                    keysBody.innerHTML = keys.map(key => `
                        <tr>
                            <td style="font-family: monospace; font-size: 0.8rem;">
                                <i class="fas fa-key" style="color: var(--primary); opacity: 0.6; margin-right: 0.5rem;"></i>
                                ${key}
                            </td>
                            <td>
                                <span class="badge badge-success">
                                    <i class="fas fa-check-circle"></i> Cached
                                </span>
                            </td>
                        </tr>
                    `).join('');
                }
            }
        }
    } catch (err) {
        console.error('refreshCacheMetrics error:', err);
        showToast(err.message || 'Failed to load cache metrics', 'error');

        // Show error in keys table
        if (keysBody) {
            keysBody.innerHTML = `
                <tr>
                    <td colspan="2" style="text-align: center; color: var(--error); padding: 2rem;">
                        <i class="fas fa-exclamation-triangle"></i> ${err.message || 'Failed to load cache keys'}
                    </td>
                </tr>
            `;
        }
    }
}

export async function flushCache() {
    // Confirmation before flushing
    const confirmed = confirm('Are you sure you want to flush (clear) the entire cache? This will temporarily slow down the system until the cache is rebuilt.');
    if (!confirmed) return;

    const btn = document.querySelector('[onclick="flushCache()"]');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Flushing...';
    }

    try {
        const res = await fetch('/api/cache-flush', { method: 'POST' });
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.message || 'Failed to flush cache');
        }
        const data = await res.json();

        if (data.status === 'ok') {
            showToast(data.message || 'Cache flushed successfully!', 'success');
            // Refresh metrics after flush
            refreshCacheMetrics();
        } else {
            showToast(data.message || 'Failed to flush cache', 'error');
        }
    } catch (err) {
        console.error('flushCache error:', err);
        showToast(err.message || 'Network error while flushing cache', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash-alt"></i> Flush Cache';
        }
    }
}

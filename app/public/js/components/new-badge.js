/**
 * <new-badge> — reusable "NEW" feature badge component.
 *
 * Usage:
 *   <new-badge></new-badge>              → renders "NEW"
 *   <new-badge label="BETA"></new-badge> → renders "BETA"
 *   <new-badge>New</new-badge>           → renders authored text
 *
 * Styling is driven by the .new-badge class in style.css so it follows
 * the app's existing design tokens (dark/light theme aware).
 */
(function () {
    class NewBadge extends HTMLElement {
        connectedCallback() {
            if (this._rendered) return;
            this._rendered = true;

            const badge = document.createElement('span');
            badge.className = 'new-badge';

            const label = this.getAttribute('label');
            const text = (this.textContent || '').trim();

            badge.textContent = label || text || 'NEW';

            this.textContent = '';
            this.appendChild(badge);
        }
    }

    if (!customElements.get('new-badge')) {
        customElements.define('new-badge', NewBadge);
    }
})();

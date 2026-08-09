/**
 * icon.js — Shared Lucide SVG icon registry for every Express page.
 *
 * Replaces Font Awesome glyph fonts with inline Lucide SVGs that inherit
 * their color and size from the surrounding CSS:
 *   - stroke="currentColor"  -> icon follows the element's CSS color.
 *   - width/height = 1em     -> icon scales with the element's font-size,
 *     exactly like a Font Awesome glyph (so no CSS/layout changes needed).
 *
 * Usage:
 *   1. Include the script once per page:
 *          <script src="js/icon.js"></script>
 *
 *   2. In HTML, drop a placeholder element with data-icon (keeps the host
 *      element so existing selectors like `.live-action i` still apply):
 *          <i data-icon="log-in" aria-hidden="true"></i>
 *      Placeholders are auto-filled as soon as the script loads.
 *
 *   3. In JS, generate markup for dynamic content:
 *          el.innerHTML = icon('fingerprint');
 *      Re-scan injected content afterwards:
 *          renderIcons(containerElement);
 *
 * Icon names follow Lucide (https://lucide.dev). Font Awesome aliases are
 * kept so legacy names keep working, e.g.:
 *   'log-in'               / 'arrow-right-to-bracket'
 *   'log-out'              / 'arrow-right-from-bracket'
 *   'rotate-cw'            / 'rotate-right'
 *   'shield-check'         / 'shield-halved'
 */
(function (global) {
    'use strict'

    var VIEWBOX = '0 0 24 24'

    // Lucide icon bodies (markup between <svg> and </svg>), keyed by
    // canonical name. All icons use the default Lucide stroke style.
    var ICONS = {
        'log-in': {
            body: '<path d="m10 17 5-5-5-5"/>' +
                '<path d="M15 12H3"/>' +
                '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>'
        },
        'log-out': {
            body: '<path d="m16 17 5-5-5-5"/>' +
                '<path d="M21 12H9"/>' +
                '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>'
        },
        'arrow-left': {
            body: '<path d="m12 19-7-7 7-7"/>' +
                '<path d="M19 12H5"/>'
        },
        'rotate-cw': {
            body: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>' +
                '<path d="M21 3v5h-5"/>'
        },
        'shield-check': {
            body: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>' +
                '<path d="m9 12 2 2 4-4"/>'
        },
        'check': {
            body: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/>' +
                '<path d="m9 11 3 3L22 4"/>'
        },
        'fingerprint': {
            body: '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>' +
                '<path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>' +
                '<path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>' +
                '<path d="M2 12a10 10 0 0 1 18-6"/>' +
                '<path d="M2 16h.01"/>' +
                '<path d="M21.8 16c.2-2 .131-5.354 0-6"/>' +
                '<path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>' +
                '<path d="M8.65 22c.21-.66.45-1.32.57-2"/>' +
                '<path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>'
        }
    }

    // Font Awesome 6 names -> Lucide canonical names.
    var ALIASES = {
        'arrow-right-to-bracket': 'log-in',
        'arrow-right-from-bracket': 'log-out',
        'rotate-right': 'rotate-cw',
        'shield-halved': 'shield-check'
    }

    /**
     * Resolve a user-supplied name to a canonical Lucide key.
     * Accepts canonical names and FA aliases (optionally "fa-" prefixed).
     */
    function resolve(name) {
        if (typeof name !== 'string') return null
        name = name.trim().replace(/^fa-/, '')
        return ICONS[name] ? name : (ALIASES[name] || null)
    }

    /**
     * Build an SVG string for an icon.
     * @param {string} name Canonical Lucide name or Font Awesome alias.
     * @param {object} [options]
     *   - width, height:  defaults to '1em' (inherits CSS font-size).
     *   - className:      extra class(es) to add to the <svg>.
     * @returns {string} SVG markup, or '' when the icon is unknown.
     */
    function icon(name, options) {
        var key = resolve(name)
        if (!key) return ''
        var o = options || {}
        var width = o.width || '1em'
        var height = o.height || '1em'
        var cls = o.className ? ' class="' + o.className + '"' : ''
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"' +
            ' viewBox="' + VIEWBOX + '" fill="none" stroke="currentColor" stroke-width="2"' +
            ' stroke-linecap="round" stroke-linejoin="round"' + cls +
            ' style="vertical-align:-0.125em" aria-hidden="true">' +
            ICONS[key].body + '</svg>'
    }

    /**
     * Fill one placeholder element with its matching SVG.
     * The host element is preserved (so its CSS classes and aria-hidden
     * keep working); only the inner markup is replaced.
     */
    function renderElement(el) {
        if (!el || el.getAttribute('data-icon-rendered')) return
        var markup = icon(el.getAttribute('data-icon'))
        if (!markup) return
        el.setAttribute('data-icon-rendered', '1')
        el.innerHTML = markup
    }

    /**
     * Render every [data-icon] placeholder inside a scope.
     * @param {Element|string} [root] Element or CSS selector to scan.
     *                                Defaults to the whole document.
     */
    function renderIcons(root) {
        var scope = root || document
        if (typeof scope === 'string') {
            var matches = document.querySelectorAll(scope)
            for (var m = 0; m < matches.length; m++) renderIcons(matches[m])
            return
        }
        if (!scope || !scope.querySelectorAll) return
        if (scope.getAttribute && scope.getAttribute('data-icon')) renderElement(scope)
        var els = scope.querySelectorAll('[data-icon]')
        for (var i = 0; i < els.length; i++) renderElement(els[i])
    }

    // Auto-render on load — works whether the script is in <head> or at the
    // end of <body>. Safe to call on any Express page.
    function boot() {
        renderIcons()
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot)
    } else {
        boot()
    }

    global.icon = icon
    global.renderIcons = renderIcons
    global.ICON_REGISTRY = ICONS
})(typeof window !== 'undefined' ? window : this)

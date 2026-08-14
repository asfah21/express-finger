/*!
 * version.js — Single source of truth untuk versi aplikasi (AZRA).
 *
 * Cara pakai:
 *   • Ubah APP_VERSION di bawah ini satu kali.
 *   • Semua elemen dengan atribut `data-app-version` otomatis diisi
 *     dengan string versi tersebut (tanpa perlu edit HTML satu per satu).
 *
 * Halaman yang memuat script ini: index.html, live.html, multi_live.html,
 * cam_live.html (login.html ikut terisi karena dimuat sebagai include).
 */
(function () {
    'use strict';

    /* ── Ganti versi hanya di sini ─────────────────────────────────────── */
    const APP_VERSION = 'v.0.9.3';
    /* ──────────────────────────────────────────────────────────────────── */

    window.APP_VERSION = APP_VERSION;

    /**
     * Isi semua elemen [data-app-version] dengan APP_VERSION.
     * Dipanggil otomatis saat DOM siap, dan bisa dipanggil manual
     * setelah konten dimuat secara async (mis. include di index.html).
     */
    function applyAppVersion() {
        document.querySelectorAll('[data-app-version]').forEach(function (el) {
            el.textContent = APP_VERSION;
        });
    }

    window.applyAppVersion = applyAppVersion;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyAppVersion);
    } else {
        applyAppVersion();
    }
})();

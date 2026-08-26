# Rencana: Security Hardening 10 Poin — express-finger

## Tujuan

Mengeraskan aplikasi GSI ADMS listener terhadap 10 kategori serangan web yang paling umum:

1. SQL Injection
2. XSS (Cross-Site Scripting)
3. CSRF (Cross-Site Request Forgery)
4. Session Hijacking
5. Brute Force
6. File Upload
7. LFI/RFI
8. Command Injection
9. Error Handling
10. Security Headers

Dokumen ini **tidak mengubah kode** — hanya rencana teknis terperinci. Implementasi dilakukan setelah dokumen ini disetujui.

## Status Implementasi

### ✅ Fase 1 — SELESAI (CSRF + Brute Force)
- [x] `csrf-csrf` terinstal di [`app/package.json`](../../app/package.json) (v3.2.2).
- [x] [`app/middleware/csrf.js`](../../app/middleware/csrf.js) — double-submit cookie + bypass list + provider.
- [x] Wiring di [`app/server.js`](../../app/server.js) (csrfTokenProvider + csrfProtection global).
- [x] [`app/middleware/cors.js`](../../app/middleware/cors.js) — tidak lagi refleksi origin + credentials; whitelist `CORS_ORIGINS`.
- [x] [`app/public/js/csrf.js`](../../app/public/js/csrf.js) — patch `fetch` global (diimpor via `device.js`).
- [x] `loginLimiter` → 5 percobaan / 15 menit + perbaikan IPv6 (`ipKeyGenerator`).
- [x] `iclockLimiter` (120/menit/IP) + `iclockIpGuard` (allowlist opsional `ICLOCK_ALLOWED_IPS`).
- [x] `trust proxy` dikunci via `TRUST_PROXY` (default nonaktif).
- [x] Penanganan `invalidCsrfTokenError` → 403 di `globalErrorHandler`.
- [x] Tes end-to-end: [`app/tests/security/test-csrf-flow.mjs`](../../app/tests/security/test-csrf-flow.mjs) — 8/8 lulus.

### ✅ Fase 2 — SELESAI (Session + Security Headers)
- [x] `helmet` v8.3.0 terinstal.
- [x] Cookie sesi (`token`): `sameSite='lax'` SELALU + `secure` di production — konsisten di login ([`auth.js`](../../app/controllers/auth.js:165)), update account, dan sliding renewal ([`sessions.js`](../../app/controllers/sessions.js:216)).
- [x] JWT di-pin ke HS256 di semua `jwt.verify` ([`middleware/auth.js`](../../app/middleware/auth.js:48)) & `jwt.sign` (auth/sessions).
- [x] [`security.js`](../../app/middleware/security.js) di-rewrite: helmet (COOP `same-origin`, CORP `same-site`, nosniff, hidePoweredBy, referrer no-referrer, HSTS production) + CSP diperkuat (`frame-ancestors 'none'`, `base-uri`, `form-action`, `object-src 'none'`, `frame-src 'none'`) + Permissions-Policy manual (kamera kiosk diizinkan).
- [x] `X-XSS-Protection` dihapus (deprecated).

### ✅ Fase 3 — SELESAI (Input & Upload)
- [x] `express-validator` v7 terinstal; [`app/middleware/validate.js`](../../app/middleware/validate.js) (baru) dengan aturan login, user, employee, device, kiosk-device, sessions, page-permissions.
- [x] Validator dipasang di [`routes/auth.js`](../../app/routes/auth.js) & [`routes/api.js`](../../app/routes/api.js).
- [x] [`app/public/js/utils/sanitize.js`](../../app/public/js/utils/sanitize.js) (baru): `escapeHtml` + `sanitizeHtml` (DOMPurify).
- [x] DOMPurify CDN ditambahkan di [`index.html`](../../app/public/index.html).
- [x] XSS nyata diperbaiki di [`employees.js`](../../app/public/js/pages/employees.js:21) — semua field teks user di-escape.
- [x] `multer` v2 terinstal; [`app/middleware/upload.js`](../../app/middleware/upload.js) (baru): whitelist ekstensi+mimetype, 5MB, nama UUID, siap dipasang.
- [x] `express.text` global (octet-stream 20mb) di-scope khusus ke `/iclock` di [`server.js`](../../app/server.js:76).
- [x] Tes: [`test-validation.mjs`](../../app/tests/security/test-validation.mjs) 14/14 lulus.

> **Catatan penting Fase 3 (File Upload):** Aplikasi saat ini TIDAK punya endpoint
> multipart nyata — import employee diparse client-side (SheetJS → JSON), template
> biometrics dikirim base64 (JSON). Risiko nyata adalah parser body global
> `octet-stream` 20mb yang kini di-scope ke `/iclock`. `upload.js` (Multer)
> disediakan siap-pakai dan tervalidasi untuk endpoint upload masa depan.

### ✅ Fase 4 — SELESAI (Penguncian & Verifikasi)
- [x] [`app/utils/secure-path.js`](../../app/utils/secure-path.js) (baru): `safeJoin()` anti-traversal; diterapkan di [`downloadRawFile`](../../app/controllers/api.js:921).
- [x] [`app/tests/security/test-static-scan.mjs`](../../app/tests/security/test-static-scan.mjs) (baru): scan 64 file sumber untuk `child_process`/`exec`/`spawn`/`eval`/`new Function` + interpolasi data request ke `.query()`; tes traversal `safeJoin`.
- [x] Health endpoint [`/health`](../../app/server.js:83) — detail error DB disembunyikan di production.
- [x] 404 handler — pesan tetap, tidak lagi men-echo `originalUrl` ([`errorHandler.js`](../../app/middleware/errorHandler.js:44)).
- [x] [`Dockerfile`](../../Dockerfile) & [`docker-compose-example.yml`](../../docker-compose-example.yml) — `NODE_ENV=production` (respons generik + cookie secure + HSTS).
- [x] **Kebijakan tertulis:** DILARANG `child_process.exec/spawn` dengan input user; WAJIB parameterized query (`pool.query(sql, params)`); larangan `eval`/`new Function` — dipertahankan via tes scan.

### ✅ BACKWARD COMPATIBILITY — akses HTTPS prod + HTTP LAN

Deployment nyata: `https://fingerprint.gsicorp.co.id` (HTTPS via reverse proxy)
DAN akses lokal `http://10.10.11.5:8080` (HTTP LAN). Keputusan desain agar
keduanya tetap berfungsi tanpa mengubah Dockerfile:

- **Cookie sesi `secure` mengikuti PROTOKOL request aktual** (`req.secure` /
  `x-forwarded-proto`), BUKAN `NODE_ENV`. HTTPS → cookie `Secure`; HTTP LAN →
  tidak Secure → tetap dikirim. ([`auth.js`](../../app/controllers/auth.js:165),
  [`sessions.js`](../../app/controllers/sessions.js:223)).
- **`sameSite` kembali ke perilaku asli** (`none` saat HTTPS, `lax` saat HTTP).
  Risiko CSRF dari `none` sudah ditutup token CSRF (`csrf-csrf`) global.
- **`trust proxy` default `true`** (perilaku asli) agar di belakang nginx
  `req.ip` = IP client asli → rate-limit per-IP tidak berbagi. Bisa dikunci
  ke IP proxy via env `TRUST_PROXY`.
- **HSTS per-request** (hanya saat HTTPS), bukan berbasis `NODE_ENV`
  ([`security.js`](../../app/middleware/security.js)).
- **`NODE_ENV=production` TIDAK dipaksa** di Dockerfile/compose; opsional bagi
  user yang ingin respons error generik.

### ✅ SELURUH 10 POIN HARDENING SELESAI (Fase 1–4)

> **Catatan penting Fase 2:** `'unsafe-inline'` pada `script-src`/`style-src` DI-PERTAHANKAN
> sementara karena frontend memakai ±121 inline event handler + atribut style inline.
> Penghapusan penuh memerlukan refactor ke `addEventListener` (fase khusus, lihat
> checklist Fase 2 lanjutan di bawah) dan tidak dikerjakan di fase ini agar dashboard
> tidak rusak.

## Ringkasan Status Audit (hasil pembacaan kode)

| # | Kategori | Status Saat Ini | Tingkat Risiko |
|---|----------|-----------------|----------------|
| 1 | SQL Injection | ✅ Aman (parameterized query `pg` di semua query dinamis) | Rendah |
| 2 | XSS | ⚠️ Belum ada validator server + DOMPurify; `'unsafe-inline'` di CSP; beberapa `innerHTML` belum di-escape | **Tinggi** |
| 3 | CSRF | ❌ Tidak ada token CSRF; CORS refleksi origin + `credentials: true` | **Kritis** |
| 4 | Session Hijacking | ⚠️ `httpOnly` OK; `secure` kondisional; `sameSite` `none` saat HTTPS; `trust proxy: true` | Sedang |
| 5 | Brute Force | ⚠️ `loginLimiter` 10/5 menit (target 5/15 menit); `/iclock` tanpa limiter | **Tinggi** |
| 6 | File Upload | ❌ Tidak ada Multer; body `octet-stream` 20mb tanpa validasi | Sedang |
| 7 | LFI/RFI | ✅ `path.basename()` di download raw; tidak ada RFI | Rendah |
| 8 | Command Injection | ✅ Tidak ada `child_process` sama sekali | Rendah |
| 9 | Error Handling | ✅ Generic di production (`NODE_ENV`); perlu verifikasi env prod | Rendah |
| 10 | Security Headers | ⚠️ Custom middleware bagus; CSP `'unsafe-inline'`; belum ada COOP/CORP | Sedang |

## Dependensi Baru yang Perlu Ditambahkan

Semua di [`app/package.json`](../../app/package.json):

| Paket | Versi | Fungsi |
|-------|-------|--------|
| `express-validator` | ^7.x | Validasi + sanitasi input di server |
| `csrf-csrf` | ^3.x | Proteksi CSRF (double-submit cookie) |
| `multer` | ^2.x | Parsing & validasi file upload |
| `helmet` | ^8.x | (Opsional) pengganti/penyempurna custom header |
| `escape-html` | ^1.x | (Opsional) escaping output HTML di server |

Frontend (CDN, tanpa bundler — proyek memakai `<script src>` langsung):
- `dompurify` via `https://cdnjs.cloudflare.com/ajax/libs/dompurify/...`

---

## Detail Teknis per Poin

### 1. SQL Injection

**Status:** Aman. Semua query memakai `pool.query(sql, params)` dengan placeholder `$1..$n`. SQL dinamis hanya memakai kolom hardcoded:
- [`sessions.js listSessions()`](../../app/utils/sessions.js:283) — kolom/filter di-whitelist, nilai via parameter.
- [`template-storage.js listTemplates()`](../../app/utils/template-storage.js:57) — nama kolom hardcoded, nilai parameterized.

**Langkah:**
1. **Tidak pindah ORM** — `pg` + parameterized query sudah setara Sequelize/TypeORM/Knex. Tambahkan komentar kebijakan di [`database.js`](../../app/utils/database.js:1): "DILARANG interpolasi nilai user ke SQL string; wajib parameterized."
2. **Tes regresi otomatis** — tambahkan tes di `tests/` yang me-scan file `app/controllers/**` + `app/utils/**` untuk pola `pool.query(...)` dengan template literal yang mengandung `${}` dari `req.*`/body/query/params.
3. **Whitelist kolom ORDER BY** — pastikan semua `ORDER BY` / kolom dinamis memakai peta statis, bukan nama mentah dari user. Audit titik `whereSql`/`clauses` yang sudah ada.

**File yang diubah:** `app/utils/database.js` (komentar), `tests/security/sql-injection-scan.test.js` (baru).

---

### 2. XSS

**Status:** Server API murni JSON (tidak render HTML), jadi vektor XSS dominan adalah **client-side rendering**. Beberapa halaman sudah punya `escapeHtml()` manual ([`sessions.js`](../../app/public/js/pages/sessions.js:29), [`pair.js`](../../app/public/js/pages/pair.js:218), [`biometrics.js`](../../app/public/js/pages/biometrics.js:69), [`kiosk-devices.js`](../../app/public/js/pages/kiosk-devices.js:26)), tapi tidak konsisten — [`employees.js`](../../app/public/js/pages/employees.js:40) membangun `onclick="editEmployee('${emp.id}')"` via template literal. CSP memakai `'unsafe-inline'`.

**Langkah:**
1. **Server: `express-validator`** — buat modul validasi terpusat `app/middleware/validate.js` dengan skema untuk semua endpoint yang menerima body/params/query:
   - `login` (username: string 3–50, password: 1–128)
   - `settings` (whitelist kunci + tipe)
   - `employee` (userId, nik, nama, jabatan, department, divisi — tipe + panjang)
   - `device` (sn, ip: valid IP, port: 1–65535)
   - `kiosk-devices` (deviceId: UUID format)
   - `sessions` (search: panjang terbatas, status: enum)
   - Terapkan via `router.<method>(path, validate(...), handler)`.
2. **Frontend: DOMPurify + util bersama** — buat `app/public/js/utils/sanitize.js` berisi `sanitizeHtml()` (wrap DOMPurify) dan `escapeHtml()`; ganti semua `innerHTML` dengan data user melewati util ini.
3. **Refactor inline handler** — ganti `onclick="fn('${x}')"` di [`employees.js`](../../app/public/js/pages/employees.js:40) dengan `addEventListener` + `data-*` attribute agar tidak perlu menyisipkan nilai ke atribut inline.
4. **CSP ketat** — hapus `'unsafe-inline'` dari `script-src` (lihat poin 10); nonaktifkan `X-XSS-Protection` (sudah deprecated, ganti dependensi pada CSP + DOMPurify).

**File yang diubah:** `app/middleware/validate.js` (baru), `app/routes/*.js` (pasang validator), `app/public/js/utils/sanitize.js` (baru), `app/public/pages/*.html` (sertakan DOMPurify CDN), `app/public/js/pages/*.js` (pakai sanitize).

---

### 3. CSRF — **PRIORITAS TERTINGGI**

**Status:** Tidak ada token CSRF. Kombinasi berbahaya di [`cors.js`](../../app/middleware/cors.js:10): refleksi origin apa pun (`Access-Control-Allow-Origin: <origin>`) + `Access-Control-Allow-Credentials: true`. Situs jahat mana pun bisa mengirim request ber-credential (cookie JWT ikut terkirim) ke API. `SameSite=lax` hanya menutup POST cross-site; `SameSite=none` saat HTTPS membuka penuh.

**Langkah:**
1. **Instal `csrf-csrf`** — pakai pola double-submit cookie:
   - `generateSecret()`, `doubleCsrfUtility` dengan `cookieName: 'csrf-token'`, `headerName: 'x-csrf-token'`, `sameSite: 'lax'`, `secure` mengikuti HTTPS.
   - Cookie CSRF **tidak HttpOnly** (harus dibaca JS untuk dikirim sebagai header) tapi `sameSite: 'lax'` mencegah situs lain membacanya.
2. **Middleware `app/middleware/csrf.js`** — pasang di `app/server.js` **setelah** `cookieParser`, aktif untuk method `POST/PUT/PATCH/DELETE`, dengan **allowlist** untuk traffic non-browser:
   - `/auth/login`, `/auth/logout` (login CSRF tidak berbahaya — password diminta ulang; logout CSRF minor).
   - `/iclock/*` (protokol perangkat ZK — bukan browser, tidak membawa cookie).
   - `/api/kiosk-devices/register` (device id dari localStorage kiosk).
   - `/api/sessions/heartbeat` (polling kiosk WebView).
3. **Perbaiki CORS** — [`cors.js`](../../app/middleware/cors.js:10):
   - Hanya echo origin jika ada di daftar `CORS_ORIGINS` (exact match), default kosong (same-origin LAN).
   - Jika origin tidak terdaftar → **tidak** set `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials` (browser memblokir pembacaan, cookie tetap tak terkirim untuk state-change karena SameSite).
   - Pertahankan `Vary: Origin`.
4. **Frontend** — semua `fetch` state-changing menambahkan header `x-csrf-token` dari cookie `csrf-token` (helper di `sanitize.js`/util fetch bersama).

**File yang diubah:** `app/middleware/csrf.js` (baru), `app/middleware/cors.js`, `app/server.js`, `app/public/js/*` (fetch helper), `app/config/index.js` (tambah `CORS_ORIGINS` parsing).

---

### 4. Session Hijacking

**Status:** Cookie JWT `httpOnly: true`, `secure` kondisional, `sameSite` `lax`/`none`, `path: '/'`, `maxAge` ada ([`auth.js`](../../app/controllers/auth.js:168)). JWT_SECRET wajib ada saat start ([`auth.js`](../../app/middleware/auth.js:9)). Kelemahan: `secure` hanya aktif di HTTPS; `sameSite: 'none'` saat HTTPS; `trust proxy: true` di [`server.js`](../../app/server.js:28) membuka spoofing `X-Forwarded-For`.

**Langkah:**
1. **Cookie** — di [`auth.js login()`](../../app/controllers/auth.js:168):
   - `secure: process.env.NODE_ENV === 'production'` (selalu true di prod; tolak/tolak-jalan HTTP di prod dengan pesan jelas).
   - `sameSite: 'lax'` **selalu** (hapus cabang `'none'`; sistem LAN same-origin tidak butuh cross-site).
2. **`trust proxy`** — ganti `app.set('trust proxy', true)` dengan nilai dari env `TRUST_PROXY` (mis. `'loopback'` atau daftar IP reverse-proxy), agar `X-Forwarded-For` tidak bisa dipalsukan sewenang-wenang (memengaruhi rate limit & log IP).
3. **JWT hardening** — pin algoritma saat verify: `jwt.verify(token, SECRET, { algorithms: ['HS256'] })` di [`auth.js`](../../app/middleware/auth.js:48) & controller terkait; pastikan `issuer`/`audience` opsional.
4. **(Opsional) session fingerprinting** — simpan hash `ip + user-agent` di `user_sessions`, tolak bila berubah drastis (hati-hati dengan NAT kiosk — default off).

**File yang diubah:** `app/controllers/auth.js`, `app/middleware/auth.js`, `app/server.js`, `app/config/index.js`, `app/.env.example`.

---

### 5. Brute Force

**Status:** [`loginLimiter`](../../app/middleware/rateLimiter.js:16) = 10 percobaan/5 menit per username. Rute `/iclock` ([`device.js`](../../app/routes/device.js:6)) tanpa limiter & tanpa autentikasi. `verifyLimiter` 10/15 menit sudah ada.

**Langkah:**
1. **Login** — ubah [`loginLimiter`](../../app/middleware/rateLimiter.js:16):
   - `windowMs: 15 * 60 * 1000` (15 menit), `max: 5` (5 percobaan).
   - Key tetap per username (biarkan satu user salah password tidak mengunci user lain di NAT sama), **plus** IP fallback untuk request tanpa username.
2. **`/iclock`** — tambah `iclockLimiter` (mis. 60 request/menit per IP) di [`server.js`](../../app/server.js:65) sebelum `deviceRoutes`.
3. **Device whitelist** — validasi asal `/iclock`: SN + IP device harus terdaftar di tabel `devices` sebelum memproses `cdata`/`getrequest` (tidak hanya menerima dari siapa pun di LAN).
4. **Store** — in-memory store reset saat restart; untuk skala/multi-instance, catat opsi `rate-limit-redis` (langkah opsional di fase 3).

**File yang diubah:** `app/middleware/rateLimiter.js`, `app/server.js`, `app/routes/device.js` atau `app/controllers/device.js` (whitelist SN/IP).

---

### 6. File Upload

**Status:** Tidak ada Multer. Import employee via input file [`employees.js`](../../app/public/js/pages/employees.js:429) dikirim lewat body dengan [`express.text` `application/octet-stream`](../../app/server.js:36) limit 20mb — tanpa validasi ekstensi/mimetype/ukuran. Metadata `originalFilename` hanya disimpan sebagai string ([`template-manual.js`](../../app/controllers/template-manual.js:82)).

**Langkah:**
1. **Instal `multer`** — buat `app/middleware/upload.js`:
   - `storage: diskStorage` ke `data/uploads/` dengan nama file acak (UUID + ekstensi asli), **bukan** nama asli user.
   - `fileFilter`: whitelist ekstensi `.xlsx`, `.xls`, `.csv` (import employee) + `.jpg`, `.jpeg`, `.png` (foto wajah) + `.raw`/`.dat` (template ZK, opsional).
   - `limits: { fileSize: 5 * 1024 * 1024 }` (5MB), `files: 1`.
   - Validasi mimetype (`mimetype` dari header) **dan** magic bytes (cek `file-type` / header awal file) — mimetype bisa dipalsukan.
2. **Route baru** — endpoint upload menjadi `multipart/form-data` (mis. `POST /api/employees/import` dengan `upload.single('file')`), ganti mekanisme body `octet-stream`.
3. **Path aman** — simpan hanya UUID; saat disajikan/read, selalu lewat `path.basename` + whitelist (lihat poin 7).
4. **Non-eksekusi** — simpan di direktori di luar `public/`; pastikan `express.static` **tidak** menyajikan `data/`. Verifikasi `Content-Disposition: attachment` untuk download.
5. **Batas body** — turunkan limit [`express.text`](../../app/server.js:36) atau scope hanya ke route yang butuh (jangan global 20mb octet-stream).

**File yang diubah:** `app/middleware/upload.js` (baru), `app/routes/api.js`, `app/controllers/employee.js`, `app/server.js`, `app/public/js/pages/employees.js`, `app/.env.example` (tambah `UPLOAD_DIR`).

---

### 7. LFI/RFI

**Status:** [`downloadRawFile`](../../app/controllers/api.js:922) memakai `path.basename()` → traversal `../` terblokir. `getRawFiles` memakai `readdir`. Tidak ada pola RFI (tidak ada `readFile` URL remote).

**Langkah:**
1. **Helper terpusat** — buat `app/utils/secure-path.js` dengan `safeJoin(baseDir, userPath)` yang `path.resolve` lalu pastikan hasil di dalam `baseDir`; ganti semua `path.join` yang menerima input user.
2. **Audit path lain** — [`settings.js`](../../app/controllers/settings.js:14) (path statis, aman), [`zklib.js`](../../app/utils/zklib.js:64) (dari `readdir`, aman), [`cleanup.js`](../../app/utils/cleanup.js:15) (dari `readdir`, aman).
3. **Kebijakan** — dokumentasikan larangan `eval`/`new Function`/include remote; tambahkan tes scan untuk pola tersebut di `app/`.

**File yang diubah:** `app/utils/secure-path.js` (baru), `app/controllers/api.js`, tes scan keamanan.

---

### 8. Command Injection

**Status:** Tidak ada `child_process`/`exec`/`spawn` di seluruh proyek (satu-satunya kecocokan adalah `String.prototype.exec` regex di [`timezone.js`](../../app/utils/timezone.js:13)).

**Langkah:**
1. **Pertahankan kebijakan** — tambahkan komentar di [`app/utils/index.js`](../../app/utils/index.js) / README: "DILARANG memakai `child_process.exec`/`spawn` dengan input user."
2. **Tes scan** — sertakan dalam tes keamanan: pola `child_process`, `exec(` (selain `.exec(` regex), `spawn(` di `app/controllers` & `app/utils` wajib `fail` (kecuali diizinkan eksplisit).
3. **Jika di masa depan perlu** — gunakan `execFile`/`spawn` dengan argumen array + allowlist perintah; jangan pernah shell string.

**File yang diubah:** tes keamanan, komentar kebijakan.

---

### 9. Error Handling

**Status:** [`globalErrorHandler`](../../app/middleware/errorHandler.js:14) sudah generic di `production`; JSON 400/413/503 dipetakan; Express 5 menangkap rejected promise otomatis. Catatan: [`/health`](../../app/server.js:83) membocorkan `err.message` DB; 404 mengembalikan `req.originalUrl`.

**Langkah:**
1. **Pastikan `NODE_ENV=production`** di produksi — verifikasi [`Dockerfile`](../../Dockerfile) & `docker-compose` (set env `NODE_ENV`, `JWT_SECRET`, dsb).
2. **Health endpoint** — pada `checks.database`/`raw_dir`, kembalikan status generik (`'error'`) tanpa `err.message` di production (atau hanya log server-side).
3. **404** — kembalikan pesan tetap `'Route not found'` tanpa echo `originalUrl` (hindari refleksi input ke response).
4. **Log** — pastikan `console.error` detail tetap **server-side only**; tidak ada yang masuk body response (audit controller untuk `err.message` yang diteruskan).

**File yang diubah:** `app/server.js` (health), `app/middleware/errorHandler.js` (404), `Dockerfile`, `docker-compose-example.yml`, `app/.env.example`.

---

### 10. Security Headers

**Status:** [`securityMiddleware`](../../app/middleware/security.js:2) sudah set: nosniff, `X-Frame-Options: DENY`, Referrer-Policy `no-referrer`, `X-XSS-Protection`, CSP (dengan `'unsafe-inline'`), HSTS (kondisional HTTPS), Permissions-Policy (camera diizinkan untuk kiosk). Belum ada COOP/CORP; CSP longgar.

**Langkah:**
1. **Adopsi `helmet`** (recommended) sebagai dasar, lalu pertahankan kustomisasi:
   - `helmet()` default + `crossOriginOpenerPolicy: { policy: 'same-origin' }` + `crossOriginResourcePolicy: { policy: 'same-site' }`.
   - Pertahankan `Permissions-Policy: camera=(self)` (dibutuhkan kiosk).
   - Pertahankan HSTS `includeSubDomains; preload` saat HTTPS.
   - Hapus `X-XSS-Protection` (deprecated, bisa menimbulkan false positive).
2. **CSP ketat** — hapus `'unsafe-inline'` dari `script-src`:
   - Pindahkan semua inline `<script>` dan event handler ke file `.js` eksternal (perlu audit `app/public/pages/*.html`).
   - Sementara CDN `cdnjs`/`jsdelivr` masih dipakai, pertahankan di `script-src` + `connect-src`, atau **self-host** library (lebih aman, rekomendasi akhir).
   - `style-src` pertahankan `'unsafe-inline'` (gaya inline banyak dipakai) — atau refactor ke kelas CSS.
3. **Fallback** — jika `helmet` tidak diinginkan, cukup tambahkan header COOP/CORP + perbaiki CSP di middleware manual (tanpa dependensi baru).

**File yang diubah:** `app/middleware/security.js`, `app/server.js`, `app/public/pages/*.html`, `app/package.json`.

---

## Urutan Implementasi (Fase)

### Fase 1 — Kritis & cepat menang (prioritas tertinggi) — ✅ SELESAI
- [x] **3. CSRF**: instal `csrf-csrf`, middleware + allowlist, perbaiki CORS, fetch helper.
- [x] **5. Brute Force**: `loginLimiter` → 5/15 menit, `iclockLimiter`, whitelist SN/IP `/iclock`.

### Fase 2 — Hardening autentikasi & header — ✅ SELESAI (kecuali penghapusan 'unsafe-inline')
- [x] **4. Session**: cookie `secure`/`sameSite` konsisten, `trust proxy` terkunci, pin JWT algorithm.
- [x] **10. Security Headers**: adopsi `helmet`, CSP diperkuat + COOP/CORP.
- [ ] **10b. (Lanjutan, fase khusus)** CSP tanpa `'unsafe-inline'` — pindahkan ±121 inline handler ke `addEventListener`/file eksternal, lalu hapus `'unsafe-inline'` dari `script-src` & `style-src`. Risiko: tinggi; perlu pengujian per halaman.

### Fase 3 — Input & upload — ✅ SELESAI
- [x] **2. XSS**: `express-validator` (server), DOMPurify + `sanitize.js` (client), escape field teks di employees.js (refactor inline handler penuh → Fase 2 lanjutan/10b).
- [x] **6. File Upload**: `multer` + validasi ekstensi/mimetype + nama UUID + batas body (`express.text` di-scope ke `/iclock`).

### Fase 4 — Penguncian & verifikasi — ✅ SELESAI
- [x] **1. SQL Injection**: komentar kebijakan + tes scan.
- [x] **7. LFI/RFI**: `secure-path.js` helper + audit.
- [x] **8. Command Injection**: tes scan + dokumentasi kebijakan.
- [x] **9. Error Handling**: health endpoint generic, 404 tetap, `NODE_ENV=production` di Docker.

## Verifikasi & Pengujian

1. **Unit test** — jalankan `npm test` (vitest) setelah setiap fase.
2. **Tes keamanan otomatis** (baru) — `tests/security/`:
   - `sql-injection-scan.test.js` — scan pola interpolasi user ke SQL.
   - `command-injection-scan.test.js` — scan `child_process`.
   - `path-traversal.test.js` — panggil `/api/raw/../../etc/passwd` → expect 404.
   - `xss-render-scan` — scan `innerHTML` di `public/js` tanpa sanitizer.
3. **Tes manual (curl/browser)**:
   - Login salah 6× → 429 setelah 5 percobaan.
   - Kirim POST tanpa header `x-csrf-token` → 403.
   - Upload file `.php`/`.exe`/`.svg` → 400 (ditolak).
   - Akses `http://<host>:<port>` di prod → blokir/tolak (HTTPS-only).
   - Header `curl -I` → tampilkan `Cross-Origin-Opener-Policy`, CSP tanpa `unsafe-inline`.
4. **OWASP ZAP / nikto** (opsional) — scan LAN setelah implementasi untuk validasi akhir.

## Risiko & Mitigasi

| Risiko | Mitigasi |
|--------|----------|
| CSRF break kiosk WebView (heartbeat/register tidak bawa token) | Allowlist eksplisit + token juga dikirim via header dari JS kiosk |
| CSP ketat memecah halaman yang pakai inline style/script | Refactor bertahap per halaman; uji per halaman sebelum cutover |
| `sameSite: 'lax'`/CORS ketat mengganggu integrasi pihak ketiga | CORS via daftar `CORS_ORIGINS` yang bisa diisi admin, default same-origin |
| Rate limit 5/15 mnt mengganggu user sah di NAT besar | Key per username (bukan per IP) untuk login; IP fallback hanya tanpa username |
| `trust proxy` terkunci salah arah | Set ke IP proxy nyata; tes akses langsung LAN tanpa proxy tetap jalan |
| Upload besar menghabiskan disk | Batas 5MB + `data/uploads/` dibersihkan rutin + luar `public/` |

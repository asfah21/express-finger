# Express Finger (GSI ADMS Listener & Dashboard)

Express Finger adalah aplikasi Node.js berkinerja tinggi yang dirancang sebagai server pendengar (listener server) untuk perangkat absensi Solution Fingerprint menggunakan protokol ADMS (Automatic Data Master Server). Selain sebagai listener, aplikasi ini kini dilengkapi dengan **Web Dashboard** modern untuk manajemen perangkat, karyawan, dan monitoring log secara real-time.

## Fitur Unggulan

-   **Web Dashboard Modern**: Antarmuka grafis (GUI) berbasis web dengan desain glassmorphism yang premium untuk mempermudah operasional.
-   **Dukungan Protokol ADMS**: Kompatibel sepenuhnya dengan protokol push perangkat Solution Fingerprint/ZKTeco.
-   **Auto-Tracking IP (Dynamic IP)**: Server otomatis mengupdate IP mesin setiap kali mesin melakukan kontak (PUSH), sehingga fitur PULL tetap berjalan meskipun IP mesin berubah-ubah.
-   **Manajemen Karyawan**: Fitur upload/tambah karyawan dan sinkronisasi data dari mesin ke database.
-   **Hybrid Sync Logic**: Kombinasi PUSH (real-time) dan PULL (scheduled) untuk memastikan integritas data 100%.
-   **Sistem Auth Keamanan**: Login dashboard menggunakan JWT (JSON Web Token) dan proteksi API menggunakan API Key.
-   **Kiosk Attendance Lock (Device Whitelist)**: Akun role `public` untuk kiosk absensi wajib terdaftar & di-approve admin (1 device = 1 user), sesinya tidak pernah kedaluwarsa selama kiosk online (sliding renewal), dan endpoint attendance digerbang oleh device yang sudah di-approve.
-   **Siap Docker**: Deployment instan menggunakan Docker Compose.

## Screenshot Dashboard
*(Dashboard dapat diakses melalui browser setelah aplikasi dijalankan)*

## Prasyarat

-   [Node.js](https://nodejs.org/) (v16 atau lebih baru)
-   [PostgreSQL](https://www.postgresql.org/)
-   [Docker](https://www.docker.com/) (Opsional)

## Instalasi & Pengaturan

### 1. Menjalankan Secara Lokal

1. Clone repository dan masuk ke direktori:
   ```bash
   cd express-finger/app
   npm install
   ```

2. Konfigurasi Database di file `.env`:
   ```env
   PORT=8080
   PGHOST=localhost
   PGUSER=postgres
   PGPASSWORD=password
   PGDATABASE=express_finger
   API_KEY=your-secret-key
   JWT_SECRET=another-secret-key
   ```

3. Jalankan aplikasi:
   ```bash
   npm start
   ```

### 2. Menggunakan Docker (Rekomendasi)

```bash
docker-compose up -d --build
```

---

## Panduan Web Dashboard (GUI)

Setelah aplikasi berjalan, buka browser dan akses:
**`http://localhost:8080`**

### Kredensial Default
-   **Username**: `admin`
-   **Password**: `admin123`
*(Sangat disarankan untuk mengubah password di database setelah login pertama kali)*

### Modul Dashboard:
1.  **Overview**: Statistik cepat jumlah perangkat, karyawan, dan total log hari ini.
2.  **Devices**: Tambah, edit, hapus, dan lakukan sinkronisasi manual ke mesin spesifik.
3.  **Employees**: Kelola data karyawan. Anda bisa menginput manual atau melakukan "Pull All" untuk menyedot data karyawan yang terdaftar di mesin fingerprint.
4.  **Attendance Logs**: Filter dan pantau log absensi yang masuk dengan antarmuka yang bersih.
5.  **Settings**: Konfigurasi pemetaan tipe absensi dan alias nama perangkat.

---

## Dokumentasi API

Aplikasi menyediakan REST API yang bisa digunakan untuk integrasi dengan sistem lain (seperti Odoo, ERP, dll).

### Format Respons Standard
Semua respons API kini menggunakan format objek yang konsisten:
```json
{
  "status": "success",
  "message": "Optional message",
  "data": { ... }
}
```

### Autentikasi API
Untuk akses programatik (non-browser), sertakan header:
`x-api-key: <API_KEY_ANDA>`

### Endpoint Utama:

#### 1. Log Absensi
-   **URL**: `GET /api/logs`
-   **Parameters**: `user_id`, `from` (YYYY-MM-DD), `to`, `limit`, `offset`.
-   **Deskripsi**: Mengambil log absensi yang sudah terproses.

#### 2. Manajemen Karyawan
-   **URL**: `GET|POST|PUT|DELETE /api/employees`
-   **Bulk Import**: `POST /api/employees/bulk` (Mendukung file Excel via Dashboard)
-   **Fields**: `user_id`, `nama`, `nik`, `jabatan`, `department`.
-   **Export/Import**: Mendukung format **Excel (.xlsx)** melalui GUI Dashboard.
-   **Deskripsi**: Sinkronisasi data karyawan antara database dan sistem eksternal.

#### 3. Sinkronisasi (PULL)
-   **URL**: `POST /api/sync/all`
-   **Deskripsi**: Memerintahkan server untuk menarik data dari semua mesin yang online.
-   **Tips**: Gunakan `?stream=true` untuk melihat log progres secara real-time di terminal/console.

---

## Security & Rate Limiting (Hardening)

Aplikasi memakai `express-rate-limit` v8 dengan strategi berlapis (defense in
depth). Saat ambang batas terlampaui, server membalas **HTTP 429** lengkap
dengan header standar `RateLimit-*` dan `Retry-After` (JSON untuk API, teks
polos untuk protokol `/iclock`).

### Lapisan Proteksi
- **Global catch-all** — setiap request (termasuk `/`, `/health`, file statis,
  dan rute tak dikenal) dibatasi per-IP untuk menahan banjir/DoS.
- **Login** — dua lapisan: per-akun (username) 5×/15 menit **dan** per-IP
  20×/15 menit (menangkal brute force satu akun sekaligus password spraying
  lintas-akun dari satu origin/NAT).
- **Verify** (autentikasi ulang settings) — per-IP 10×/15 menit + per-akun
  5×/15 menit.
- **User management** (buat/hapus/reset user, ubah role) — per-IP 20×/15 menit
  + per-akun 10×/15 menit, agar sesi superadmin yang disusupi tidak bisa
  memodifikasi user secara massal.
- **General API** — 100×/menit per-IP + cap burst 30×/10 detik.
- **Sync/pull/template/biometrics** (operasi berat) — per-IP 10×/menit +
  per-perangkat target (SN/IP) 5×/menit.
- **/iclock** (protokol perangkat ZK tanpa autentikasi) — per-IP 90×/menit +
  per-SN 120×/menit, ditambah IP allowlist opsional (`ICLOCK_ALLOWED_IPS`).
- **Kiosk live** (absensi wajah) — per-perangkat (`x-device-id`) 30×/menit +
  per-IP 60×/menit.

### Konfigurasi
Semua ambang batas dapat disetel tanpa mengubah kode melalui env `RATE_LIMIT_*`
(lihat [`app/.env.example`](app/.env.example)).

### `TRUST_PROXY` (PENTING)
- **Default aman = kosong (false)** → `req.ip` = IP socket; klien **tidak**
  bisa memalsukan `X-Forwarded-For` untuk mem-bypass rate-limit per-IP.
- Di belakang nginx/Caddy, set `TRUST_PROXY=1` (satu hop) atau IP proxy agar
  `req.ip` tetap IP klien asli.
- **JANGAN** set `TRUST_PROXY=true` — mempercayai semua proxy memungkinkan
  spoofing header, dan express-rate-limit v8 menolaknya secara eksplisit
  (`ERR_ERL_PERMISSIVE_TRUST_PROXY`).

---

## Struktur Folder
```
express-finger/
├── app/
│   ├── public/         # File Frontend Dashboard (HTML/CSS/JS)
│   ├── controllers/    # Logika Backend & API
│   ├── routes/         # Definisi Rute HTTP
│   ├── middleware/     # Auth & Security
│   └── utils/          # Database & ZKLib Integration
├── data/               # Penyimpanan logs mentah (ADMS)
└── docker-compose.yml
```

## Troubleshooting
-   **Gagal Login**: Pastikan koneksi database PostgreSQL stabil dan tabel `users` telah terbuat otomatis.
-   **Mesin Offline di Dashboard**: Pastikan Port 4370 di mesin bisa diakses oleh server atau menggunakan VPN/ZeroTier jika mesin berada di jaringan berbeda.
-   **Waktu Tidak Sesuai**: Cek pengaturan Timezone pada server dan mesin fingerprint.
# Template Sync Operations

Template Sync keeps the server-side template store authoritative. The configured
template master is read during **Pull Master**, while target devices are only
changed by an explicit **Push** or **Push All** operation.

## Safety rules

- Capability status must be `SUPPORTED` before a template write is attempted.
- Unknown or unprobed device/model/firmware combinations are denied by default.
- Dry-run performs reads and diff planning only; it does not write or delete.
- Deletes require both `allowDelete=true` and `confirmDelete=true` in the request.
- Logs contain checksums, sizes, status, and limited evidence metadata; raw biometric payloads are not logged.
- Auto-sync is disabled by default and uses the same device lock as other ZK operations.

## Recommended rollout

1. Configure exactly one active template master in the Devices page.
2. Run **Pull Master** and verify the returned count and audit log.
3. Select one target device and run **Dry Run**; review `ADD`, `UPDATE`, `SKIP_UNCHANGED`, and `SKIP_INCOMPATIBLE` results.
4. Run **Push** for that device and verify fingerprints/faces on hardware.
5. Expand to a limited target group, then use **Push All** after operational validation.

## Re-probe procedure

Run the probe procedure again whenever a device model, firmware, or serial number changes. Do not copy capability results between models. Keep probe fixtures outside production storage and remove temporary test templates after validation.

## Rollback

Disable template auto-sync, stop the rollout, and restore the prior server template snapshot through the configured storage backup. Do not delete target templates as a rollback shortcut; deletion remains an explicit, separately approved operation.

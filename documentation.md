# Express Finger (GSI ADMS Listener)

Express Finger adalah aplikasi Node.js berkinerja tinggi yang dirancang sebagai server pendengar (listener server) untuk perangkat absensi Solution Fingerprint menggunakan protokol ADMS (Automatic Data Master Server). Aplikasi ini menerima data absensi yang dikirim (push) oleh perangkat, menyimpannya dalam database PostgreSQL, dan menyediakan API untuk mengakses log dan statistik.

## Fitur

-   **Dukungan Protokol ADMS**: Kompatibel sepenuhnya dengan protokol push perangkat Solution Fingerprint.
-   **Auto-Tracking IP (Dynamic IP)**: Server otomatis mengupdate IP mesin setiap kali mesin melakukan kontak (PUSH), sehingga fitur PULL tetap berjalan meskipun IP mesin berubah-ubah.
-   **Persistensi Data**: Menyimpan log absensi terpusat dan data karyawan secara efisien di PostgreSQL.
-   **Backup Data Mentah**: Menyimpan data request mentah ke sistem file untuk cadangan dan audit.
-   **RESTful API**: Menyediakan endpoint untuk mengambil log, data karyawan, statistik harian, dan pengaturan mesin/status.
-   **Worker Service (Hybrid)**: Fitur penarikan data (PULL) otomatis untuk sinkronisasi data yang gagal terkirim via PUSH. Worker secara pintar mendeteksi IP Publik (tanpa port-forwarding) dan akan melewatinya secara otomatis untuk menghindari Timeout berlebihan.
-   **Keamanan**: Endpoint pengelolaan dilindungi menggunakan mekanisme API Key.
-   **Siap Docker**: Dilengkapi dengan konfigurasi Docker dan Docker Compose untuk kemudahan deployment.
-   **Logging**: Pencatatan request HTTP yang komprehensif.

## Prasyarat

Sebelum menjalankan proyek ini, pastikan Anda telah menginstal:

-   [Node.js](https://nodejs.org/) (v14 atau lebih baru disarankan)
-   [PostgreSQL](https://www.postgresql.org/)
-   [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/) (untuk deployment menggunakan container)

## Instalasi & Pengaturan

### 1. Clone Repository

```bash
git clone <repository-url>
cd express-finger
```

### 2. Konfigurasi Environment

Aplikasi ini dapat dikonfigurasi melalui variabel environment. Anda dapat mengaturnya dalam file `.env` atau langsung di environment sistem Anda.

### 3. Menjalankan Secara Lokal

Instal dependensi:

```bash
cd app
npm install
```

Jalankan server:

```bash
npm start
```

### 4. Menjalankan dengan Docker Compose

Ini adalah cara yang disarankan untuk menjalankan aplikasi di production.

```bash
docker-compose up -d --build
```

Perintah ini akan menjalankan layanan `zkteco-listener` pada jaringan host.

## Keamanan & Integritas Data

Aplikasi ini didesain agar aman dijalankan pada environment yang sudah memiliki data/tabel sebelumnya:

1.  **Skema Aman**: Inisialisasi database menggunakan perintah `IF NOT EXISTS`. Jika tabel `attendance_logs` sudah ada, aplikasi tidak akan menimpa atau menghapusnya.
2.  **Tanpa Duplikasi**: Menggunakan mekanisme `ON CONFLICT DO NOTHING` sehingga data lama Anda tetap aman dan tidak akan terjadi penggandaan log jika mesin mengirim ulang data yang sama.
3.  **Konektivitas**: Menggunakan `network_mode: "host"` di Docker, sehingga aplikasi langsung menggunakan layanan PostgreSQL yang sudah berjalan di server host Anda.

## Dokumentasi API

### Endpoint Komunikasi Perangkat
Endpoint ini digunakan oleh perangkat Solution Fingerprint/ZKTeco.

#### 1. Menerima Data Absensi
-   **URL**: `/iclock/cdata`
-   **Method**: `POST`
-   **Deskripsi**: Menerima data push dari perangkat (log absensi, log operasi, dll).

#### 2. Detak Jantung Perangkat (Device Heartbeat)
-   **URL**: `/iclock/getrequest`
-   **Method**: `GET`
-   **Deskripsi**: Digunakan oleh perangkat untuk mengecek konektivitas server dan perintah yang tertunda.

---

### API Manajemen
Semua endpoint di bawah ini memerlukan header `x-api-key` dengan API Key yang benar.

#### 1. Ambil Log Absensi
-   **URL**: `/api/logs`
-   **Method**: `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Mengambil log absensi yang telah diproses dari database. Log yang dihasilkan juga digabungkan (LEFT JOIN) dengan data Employee. Respons mencakup kolom `absensi` (dari pemetaan Type) dan `device_name` (nama alias perangkat).

#### 2. Karyawan (Directory Employee)
-   **URL**: `/api/employees` (dan `/api/employees/:id`)
-   **Method**: `GET`, `POST`, `PUT`, `DELETE`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Mengelola daftar karyawan yang akan terkait dengan log absen (kolom: user_id, nik, nama, jabatan, department).

#### 3. Pengaturan Mesin & Tipe Absen (Settings)
-   **URL**: `/api/settings`
-   **Method**: `GET`, `PUT`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Mengambil atau memperbarui terjemahan teks untuk tipe absensi (0: Masuk, 1: Pulang, dll) dan pemetaan Device Serial Number menjadi nama yang lebih mudah dibaca. Disimpan sebagai konfigurasi JSON.

#### 2. Ambil Statistik Harian
-   **URL**: `/api/stats/daily`
-   **Method**: `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Statistik spesifik mengenai absensi harian.

#### 6. Daftar File Mentah
-   **URL**: `/api/raw`
-   **Method**: `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Mendapatkan daftar file request mentah yang tersimpan di sistem.

#### 7. Unduh File Mentah
-   **URL**: `/api/raw/:name`
-   **Method**: `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Mengunduh konten file mentah tertentu.

#### 8. Manajemen Perangkat (Device Registry)
-   **URL**: `/api/devices` (dan `/api/devices/:id`)
-   **Method**: `GET`, `POST`, `PUT`, `DELETE`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Mengelola daftar perangkat fingerprint (IP & SN) untuk keperluan penarikan data (PULL).

#### 9. Sinkronisasi Log (PULL Sync)
-   **URL**: `/api/sync` atau `/api/sync/all`
-   **Method**: `POST`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Menarik data log secara manual dari perangkat menggunakan protokol TCP (Port 4370). Ini adalah solusi **Hybrid** (bisa dipicu oleh worker otomatis) untuk memastikan data yang tidak terkirim via PUSH (ADMS) tetap masuk ke server. PULL akan melewati perangkat dengan IP berjenis Public IP demi menghindari macet *timeout*.

## Struktur Proyek

```
express-finger/
├── app/
│   ├── config/         # File konfigurasi
│   ├── controllers/    # Request handlers (api, device)
│   ├── middleware/     # Custom middleware (auth, cors, dll)
│   ├── routes/         # Definisi route
│   ├── utils/          # Fungsi bantu (helper)
│   ├── server.js       # Entry point aplikasi
│   └── package.json    # Dependensi
├── data/               # Mounting point volume data
├── docker-compose.yml  # Definisi layanan Docker
└── Dockerfile          # Instruksi build image Docker
```

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
-   **Query Parameters**:
    -   `user_id`: Filter berdasarkan ID User (contoh: `?user_id=16`)
    -   `from`: Filter tanggal mulai (format: `YYYY-MM-DD` atau ISO string)
    -   `to`: Filter tanggal akhir
    -   `type`: Filter tipe absensi (0: Masuk, 1: Pulang, dll)
    -   `device_sn`: Filter berdasarkan Serial Number perangkat
    -   `limit`: Batas jumlah data (default 100)
    -   `offset`: Offset untuk pagination
-   **Deskripsi**: Mengambil log absensi yang telah diproses dari database. Log yang dihasilkan juga digabungkan (LEFT JOIN) dengan data Employee. Respons mencakup kolom `absensi` (dari pemetaan Type) dan `device_name` (nama alias perangkat).
-   **Contoh Penggunaan**:
    -   **URL dengan Filter User ID**: `http://188.245.70.138:8080/api/logs?user_id=16`
    -   **Perintah cURL**:
        ```bash
        curl -H "x-api-key: <YOUR_API_KEY>" \
             "http://188.245.70.138:8080/api/logs?user_id=16"
        ```

#### 2. Karyawan (Directory Employee)
-   **URL**: `/api/employees` (dan `/api/employees/:id`)
-   **Method**: `GET`, `POST`, `PUT`, `DELETE`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Payload (POST/PUT)**:
    ```json
    {
      "user_id": "16",
      "nik": "123456",
      "nama": "Azvan",
      "jabatan": "Developer",
      "department": "IT"
    }
    ```
-   **Deskripsi**: Mengelola daftar karyawan. Data ini digunakan untuk memberikan info nama/jabatan pada logs absensi.

#### 3. Pengaturan Mesin & Tipe Absen (Settings)
-   **URL**: `/api/settings`
-   **Method**: `GET`, `PUT`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Payload (PUT)**:
    ```json
    {
      "types": { "0": "Masuk", "1": "Pulang" },
      "devices": { "SN123": "Lobby Utama" }
    }
    ```
-   **Deskripsi**: Mengelola pemetaan teks untuk tipe absensi dan alias nama perangkat.

#### 4. Ambil Statistik Harian
-   **URL**: `/api/stats/daily?date=YYYY-MM-DD`
-   **Method**: `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Ringkasan absensi harian per karyawan (jam masuk pertama, jam pulang terakhir, total scan).

#### 5. Daftar File Mentah
-   **URL**: `/api/raw`
-   **Method**: `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Mendapatkan daftar file request mentah (ADMS push) yang tersimpan di sistem.

#### 6. Unduh File Mentah
-   **URL**: `/api/raw/:name`
-   **Method**: `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`

#### 7. Manajemen Perangkat (Device Registry)
-   **URL**: `/api/devices` (dan `/api/devices/:id`)
-   **Method**: `GET`, `POST`, `PUT`, `DELETE`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Payload (POST/PUT)**:
    ```json
    {
      "sn": "CKEB233960333",
      "name": "Mesin Depan",
      "ip": "10.242.15.136",
      "port": 4370,
      "is_active": true
    }
    ```

#### 8. Sinkronisasi Log (PULL Sync)
-   **URL**: `/api/sync` (untuk satu mesin) atau `/api/sync/all` (untuk semua mesin)
-   **Method**: `POST` atau `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Query Parameters**:
    -   `stream`: Jika diisi `true`, server akan mengirimkan progres real-time per perangkat (hanya untuk `/sync/all`).
-   **Contoh Monitoring Progres**:
    ```bash
    curl -N -H "x-api-key: <YOUR_API_KEY>" "http://URL/api/sync/all?stream=true"
    ```

---

## Mekanisme Worker (Background Sync)

Aplikasi memiliki Worker otomatis yang berjalan di latar belakang:
-   **Tugas**: Melakukan PULL sync ke semua perangkat yang aktif secara berkala.
-   **Interval**: Diatur via `SYNC_INTERVAL_MS` di `.env` (default 5 menit).
-   **Smart Logic**: Worker akan melewati (skip) perangkat dengan Public IP untuk menghindari hang, **KECUALI** perangkat tersebut didaftarkan dalam `app/config/priority_devices.js`.

---

## Troubleshooting

### 1. Data Tidak Masuk padahal Fingerprint Berhasil
-   **Cek Koneksi**: Pastikan mesin bisa "ping" ke server (untuk ADMS/Push).
-   **Port TCP 4370**: Jika menggunakan PULL, pastikan Port 4370 di sisi mesin terbuka (Forwarding jika pakai Public IP).
-   **API Key**: Pastikan middleware tidak memblokir request karena key salah.
-   **Logs**: Cek file mentah di `/api/raw` untuk melihat apakah mesin sebenarnya mengirim data tapi gagal diproses.

### 2. Error ETIMEDOUT saat PULL
-   Ini berarti server tidak bisa menjangkau Port 4370 mesin. Jika mesin di lokasi berbeda, gunakan VPN atau ZeroTier, lalu daftarkan IP VPN tersebut di `priority_devices.js`.

---

## Struktur Proyek

```
express-finger/
├── app/
│   ├── config/         # Konfigurasi & Priority List
│   ├── controllers/    # Logika API (Employee, Sync, Device)
│   ├── utils/          # Parser ADMS, Database Batch (Chunking)
│   └── server.js       # Entry Point
├── data/               # Penyimpanan logs mentah
└── docker-compose.yml
```

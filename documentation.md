# Express Finger (GSI ADMS Listener)

Express Finger adalah aplikasi Node.js berkinerja tinggi yang dirancang sebagai server pendengar (listener server) untuk perangkat absensi Solution Fingerprint menggunakan protokol ADMS (Automatic Data Master Server). Aplikasi ini menerima data absensi yang dikirim (push) oleh perangkat, menyimpannya dalam database PostgreSQL, dan menyediakan API untuk mengakses log dan statistik.

## Fitur

-   **Dukungan Protokol ADMS**: Kompatibel sepenuhnya dengan protokol push perangkat Solution Fingerprint.
-   **Persistensi Data**: Menyimpan log absensi secara efisien di PostgreSQL.
-   **Backup Data Mentah**: Menyimpan data request mentah ke sistem file untuk cadangan dan audit.
-   **RESTful API**: Menyediakan endpoint untuk mengambil log, statistik harian, dan file data mentah.
-   **Keamanan**: Endpoint API dilindungi menggunakan mekanisme API Key.
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
-   **Deskripsi**: Mengambil log absensi yang telah diproses dari database.

#### 2. Ambil Statistik Harian
-   **URL**: `/api/stats/daily`
-   **Method**: `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Statistik spesifik mengenai absensi harian.

#### 3. Daftar File Mentah
-   **URL**: `/api/raw`
-   **Method**: `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Mendapatkan daftar file request mentah yang tersimpan di sistem.

#### 4. Unduh File Mentah
-   **URL**: `/api/raw/:name`
-   **Method**: `GET`
-   **Headers**: `x-api-key: <API_KEY_ANDA>`
-   **Deskripsi**: Mengunduh konten file mentah tertentu.

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

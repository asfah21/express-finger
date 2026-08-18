# Spesifikasi Fitur: Attendance AI Intelligence

> **Dokumen ini ditujukan untuk AI coding agent.** Baca seluruh dokumen sebelum mulai coding. Ikuti urutan tahap yang tercantum di bagian "Tahap Kerja Wajib" sebelum menulis satu baris kode pun.

---

## 1. Ringkasan (Executive Summary)

Sistem absensi (attendance) berbasis fingerprint sudah berjalan dan menyimpan data ke **PostgreSQL** secara real-time. Tugasnya adalah **menambahkan** modul baru bernama **Attendance AI Intelligence** ke sistem yang sudah ada — **bukan menggantikan** attendance engine yang sudah ada.

Modul ini bertugas:
1. Membaca histori absensi (raw fingerprint log) dari database yang sudah ada.
2. Mempelajari pola individu tiap karyawan (jam IN/OUT kebiasaan, shift, pergantian shift, hari libur/cuti/izin/sakit).
3. Menginterpretasikan catatan fingerprint yang **ambigu** (misalnya status IN/OUT yang salah tercatat) menjadi interpretasi yang paling mungkin benar, lengkap dengan skor keyakinan (confidence) dan alasan (reason).
4. Mendeteksi anomali kehadiran.
5. Menyajikan hasil analisis di halaman frontend baru: **Attendance → AI**.

Sistem harus **self-hosted, offline, tanpa API AI eksternal, tanpa API token, dan tanpa GPU**.

---

## 2. Tujuan Utama

- Data fingerprint yang masuk real-time ke PostgreSQL diproses oleh AI Engine lokal.
- AI mempelajari histori absensi tiap karyawan untuk memahami pola personal mereka.
- AI mampu menyimpulkan status sebenarnya dari catatan fingerprint yang ambigu (contoh: mesin mencatat "OUT" padahal seharusnya "IN").
- AI mampu membedakan antara **kesalahan input status** vs **pergantian shift yang sah** (contoh dua pola di bawah).
- Setiap hasil analisis AI harus **auditable**: ada status, confidence score, interpreted events, dan reason yang bisa dibaca manusia (bukan black box).
- Admin dapat mengoreksi hasil AI, dan koreksi tersebut digunakan sebagai feedback untuk retraining model.

### 2.1 Contoh Kasus 1 — Salah Status Punch (Wrong Punch)

Raw fingerprint:
```text
07:03 OUT
17:31 OUT
```

Histori pola karyawan ini biasanya:
```text
06:45–07:15  IN
16:45–18:00  OUT
```

Interpretasi AI yang diharapkan:
```text
07:03 OUT → kemungkinan besar IN  (confidence tinggi, karena jam 07:03 masuk dalam window kebiasaan IN karyawan, dan tidak ada IN lain di hari itu)
17:31 OUT → tetap OUT (sesuai pola, dan tidak ada konflik)
```

### 2.2 Contoh Kasus 2 — Pergantian Shift (Shift Transition)

Raw fingerprint:
```text
07:03 OUT
17:31 IN
```

Jika diketahui karyawan sedang dalam masa pergantian shift (shift sebelumnya berakhir pagi, shift berikutnya mulai sore/malam), AI harus menyimpulkan:
```text
07:03 OUT → OUT dari shift sebelumnya (bukan kesalahan input)
17:31 IN  → IN untuk shift berikutnya
```

**Poin kritis:** kedua kasus di atas punya pola fingerprint yang mirip secara angka mentah, tapi maknanya berbeda total tergantung **konteks jadwal & shift karyawan**. AI wajib menggunakan context ini (shift saat ini, shift sebelumnya, jadwal kerja) sebagai fitur, bukan hanya melihat jam mentahnya saja.

---

## 3. Batasan Teknologi (Wajib Dipatuhi)

| Aspek | Ketentuan |
|---|---|
| Bahasa | Python |
| Model utama | LightGBM (klasifikasi/interpretasi status) |
| Anomaly detection | Isolation Forest |
| Database | PostgreSQL (yang sudah ada — tidak membuat instance database baru, integrasi ke skema existing) |
| Hosting | Self-hosted / offline sepenuhnya |
| **Dilarang** | OpenAI, Gemini, Claude, atau API AI eksternal apa pun |
| **Dilarang** | Kebutuhan API token/API key eksternal |
| **Dilarang** | Kebutuhan GPU (harus jalan di CPU) |
| Dataset training | Histori absensi yang sudah tersimpan di database existing (tidak perlu dataset eksternal) |

---

## 4. Tahap Kerja Wajib (Sebelum Coding)

AI agent **harus** menyelesaikan tahap eksplorasi ini terlebih dahulu, dan idealnya melaporkan temuannya sebelum mulai implementasi:

1. **Inspect struktur project** — pahami struktur folder backend & frontend, framework yang dipakai (mis. Laravel/Node/Django/dll — sesuaikan dengan apa yang ditemukan), konvensi penamaan, dan cara service/module lain diorganisir.
2. **Cari attendance engine existing** — temukan modul/service yang saat ini memproses data fingerprint menjadi attendance record. Pahami alur datanya: dari mesin fingerprint → tabel raw log → tabel attendance final.
3. **Cari schema PostgreSQL** — identifikasi dan dokumentasikan tabel-tabel berikut (nama sebenarnya bisa berbeda, sesuaikan dengan yang ditemukan di project):
   - Tabel raw fingerprint log (device log mentah)
   - Tabel attendance record (hasil olahan IN/OUT harian)
   - Tabel employee (data karyawan)
   - Tabel shift (definisi shift: jam mulai, jam selesai, toleransi keterlambatan, dsb.)
   - Tabel jadwal kerja / roster (siapa masuk shift apa, tanggal berapa)
   - Tabel leave/cuti, izin, sakit, hari libur/OFF
   - Relasi antar tabel di atas (foreign key)
4. **Pahami timezone dan aturan shift existing** — cek timezone yang dipakai server & database (UTC vs lokal), cara sistem existing menghitung keterlambatan, lembur, dan overnight shift (shift yang melewati tengah malam).
5. **Integrasikan, jangan mengganti** — modul AI ini adalah **layer tambahan** yang membaca data existing dan menulis hasil analisis ke tabel baru (`attendance_ai_analysis`). Attendance engine existing **tetap berjalan seperti biasa** dan tidak boleh diubah alur intinya, kecuali menambahkan hook/event agar AI Engine bisa dipicu saat ada transaksi baru.

> Jika ada informasi struktur project yang tidak ditemukan otomatis, AI agent boleh membuat asumsi wajar dan **mendokumentasikan asumsi tersebut secara eksplisit** di awal implementasi, alih-alih menebak diam-diam.

---

## 5. Jenis Anomali yang Harus Dikenali

Sistem harus mampu mengklasifikasikan/mendeteksi status berikut:

| Kode Status | Deskripsi |
|---|---|
| `NORMAL` | Absensi lengkap dan sesuai jadwal |
| `MISSING_IN` | Lupa IN (ada OUT, tidak ada IN) |
| `MISSING_OUT` | Lupa OUT (ada IN, tidak ada OUT) |
| `WRONG_IN` | Status IN yang tercatat salah (seharusnya OUT) |
| `WRONG_OUT` | Status OUT yang tercatat salah (seharusnya IN) |
| `DUPLICATE_IN` | Fingerprint IN tercatat lebih dari sekali dalam window yang sama |
| `DUPLICATE_OUT` | Fingerprint OUT tercatat lebih dari sekali dalam window yang sama |
| `LATE` | Terlambat (IN melewati jam jadwal + toleransi) |
| `EARLY_LEAVE` | Pulang cepat (OUT sebelum jam jadwal selesai) |
| `OVERTIME` | Lembur (OUT melewati jam selesai jadwal) |
| `ABSENT` | Tidak hadir tanpa keterangan |
| `LEAVE` | Cuti (sesuai data leave request yang disetujui) |
| `SICK` | Sakit |
| `PERMIT` | Izin |
| `OFF` | Hari libur/off sesuai jadwal |
| `SHIFT_TRANSITION` | Pergantian shift (fingerprint OUT shift sebelumnya + IN shift berikutnya dalam rentang waktu berdekatan) |
| `COMBINED_ANOMALY` | Kombinasi lebih dari satu anomali dalam satu hari kerja yang sama |

---

## 6. Fitur/Konteks yang Wajib Dipertimbangkan AI

Model dan rule engine harus menggunakan sinyal-sinyal berikut sebagai fitur input:

- Histori absensi karyawan yang bersangkutan (N hari/minggu terakhir)
- Pola jam IN/OUT pribadi karyawan (rata-rata, rentang/window kebiasaan, standar deviasi)
- Shift yang berlaku pada hari tersebut
- Shift sebelumnya (untuk mendeteksi shift transition & overnight shift)
- Indikasi pergantian shift (perubahan jadwal shift karyawan dari hari sebelumnya ke hari ini/besok)
- Jadwal kerja resmi (jam mulai, jam selesai, toleransi keterlambatan)
- Status hari libur/OFF karyawan tersebut
- Status cuti/izin/sakit yang sudah disetujui pada tanggal tersebut
- Urutan kronologis fingerprint dalam satu hari (mana yang tercatat lebih dulu)
- Interval waktu antar fingerprint (selisih menit antar scan)
- Pola anomali historis karyawan tersebut (apakah karyawan ini sering salah punch, sering lupa OUT, dll — dipakai sebagai prior)

---

## 7. Arsitektur: Rule Engine + AI (Hybrid)

Gunakan pendekatan **hybrid**: rule engine untuk kasus yang sudah pasti secara logika, AI (LightGBM) hanya untuk kasus ambigu.

### 7.1 Rule Engine (Deterministik, Dijalankan Lebih Dulu)

Contoh aturan pasti yang **tidak perlu** AI:

```text
Tidak ada IN + ada OUT           → kandidat MISSING_IN
Ada IN + tidak ada OUT           → kandidat MISSING_OUT
IN > jam jadwal (+toleransi)     → LATE
OUT > jam jadwal selesai         → OVERTIME
Tanggal tsb = OFF di jadwal      → OFF
Ada leave request approved       → LEAVE / SICK / PERMIT (sesuai jenis)
Fingerprint status sama, jarak < X menit → kandidat DUPLICATE
```

Rule engine menghasilkan **kandidat** status. Jika rule engine sudah bisa memastikan status dengan yakin (tidak ada ambiguitas), AI **tidak perlu** dipanggil untuk record tersebut — cukup pakai hasil rule engine langsung (efisien, dan hasilnya tetap 100% explainable).

### 7.2 AI Layer (Untuk Kasus Ambigu)

AI (LightGBM) dipanggil khusus untuk kasus yang **tidak bisa diputuskan pasti oleh rule**, terutama:
- Menentukan status sebenarnya dari punch yang statusnya diragukan (WRONG_IN / WRONG_OUT)
- Membedakan WRONG_IN/WRONG_OUT vs SHIFT_TRANSITION ketika pola fingerprint mentah terlihat mirip
- Kasus kombinasi anomali yang kompleks

Isolation Forest dipakai sebagai **layer tambahan** untuk mendeteksi transaksi yang polanya menyimpang jauh dari kebiasaan karyawan (outlier detection), sebagai sinyal pendukung/pemicu investigasi lebih lanjut, bukan sebagai penentu status akhir.

### 7.3 Output Wajib Setiap Prediksi

Setiap hasil analisis (baik dari rule engine maupun AI) harus disimpan dengan struktur berikut:

```json
{
  "status": "WRONG_OUT",
  "confidence": 0.96,
  "interpreted_events": [
    { "raw_time": "07:03", "raw_status": "OUT", "interpreted_status": "IN" },
    { "raw_time": "17:31", "raw_status": "OUT", "interpreted_status": "OUT" }
  ],
  "reason": "Pola IN karyawan biasanya berada di rentang 06:45–07:15. Fingerprint 07:03 lebih cocok sebagai IN dibanding OUT."
}
```

Contoh singkat sesuai request awal:
```text
07:03 OUT → IN
Confidence: 96%
Reason: pola IN karyawan biasanya 06:45–07:15
```

Field `reason` **wajib berupa kalimat yang bisa dibaca manusia** (human-readable), bukan hanya nilai numerik/skor fitur mentah. Field `confidence` dalam skala 0.0–1.0 (ditampilkan sebagai persentase di frontend).

---

## 8. Alur Real-Time (Data Flow)

```text
Fingerprint Device
   → PostgreSQL (raw log, sesuai sistem existing)
   → Attendance Engine (existing, tidak diubah alur intinya)
   → AI Analysis Engine (BARU — dipicu setiap ada transaksi baru)
   → tabel attendance_ai_analysis (BARU)
   → Frontend (Attendance → AI)
```

Ketentuan:
- AI Engine harus **dipicu otomatis** setiap kali ada transaksi fingerprint baru masuk (via event/hook/listener/queue job — sesuaikan dengan mekanisme event yang sudah dipakai di project existing, misalnya job queue, database trigger, atau event listener di level aplikasi).
- AI harus mampu **menganalisis ulang (re-analyze)** suatu record ketika ada transaksi baru masuk yang mempengaruhi konteks (mis. fingerprint OUT baru masuk setelah sebelumnya hanya ada IN dalam sehari itu).
- Proses analisis tidak boleh memblok/mengganggu proses pencatatan attendance existing — jalankan secara asynchronous (background job/queue), bukan sinkron dalam request yang sama.

---

## 9. Skema Data Baru (Tambahan, Bukan Pengganti)

Rancang tabel baru berikut ini (sesuaikan tipe data dengan konvensi project existing), sebagai tambahan terhadap skema yang sudah ada:

### 9.1 `attendance_ai_analysis`
Menyimpan hasil interpretasi AI per hari kerja per karyawan. Minimal berisi:
- Referensi ke employee
- Referensi ke tanggal/attendance record terkait
- Referensi ke shift yang berlaku (shift_id, previous_shift_id jika relevan)
- Status hasil analisis (`status` — lihat daftar di bagian 5)
- Confidence score
- Interpreted events (raw vs interpreted, dalam format terstruktur/JSON)
- Reason/explanation (teks)
- Sumber keputusan: `RULE_ENGINE` atau `AI_MODEL`
- Timestamp analisis, versi model yang dipakai
- Status koreksi admin (belum dikoreksi / dikoreksi / dikonfirmasi benar)

### 9.2 `attendance_ai_feedback`
Menyimpan koreksi manual dari admin terhadap hasil AI, dipakai sebagai data retraining:
- Referensi ke `attendance_ai_analysis`
- Status yang dikoreksi admin
- Admin/user yang melakukan koreksi
- Timestamp koreksi
- Catatan opsional dari admin

### 9.3 `attendance_ai_model_registry` (opsional tapi disarankan)
Metadata model yang tersimpan lokal (versi, tanggal training, jumlah data training, metrik evaluasi), agar mekanisme retraining dan rollback model bisa dilacak.

> Nama tabel/kolom di atas adalah acuan minimal — sesuaikan penamaan dengan konvensi (naming convention) yang dipakai di database existing agar konsisten.

---

## 10. Model Lifecycle: Training, Penyimpanan, dan Retraining

- **Dataset training**: diambil dari histori attendance yang sudah ada di database (tidak perlu dataset eksternal).
- **Penyimpanan model**: model LightGBM & Isolation Forest disimpan secara lokal di filesystem server (mis. format `.pkl`/`.txt` bawaan LightGBM), lengkap dengan versi & metadata di `attendance_ai_model_registry`.
- **Mekanisme retraining**:
  - Retraining terjadwal (mis. berkala mingguan/bulanan — buat konfigurasinya fleksibel/terjadwal via cron/scheduler existing project).
  - Retraining juga bisa dipicu manual oleh admin.
  - Data feedback koreksi admin (`attendance_ai_feedback`) **wajib** diikutsertakan sebagai label tambahan/koreksi pada dataset training berikutnya, sehingga model makin akurat seiring waktu (human-in-the-loop learning).
- **Inference**: model yang sedang aktif digunakan untuk prediksi real-time harus jelas versinya, dan pergantian model baru tidak boleh mengganggu proses inference yang sedang berjalan (mekanisme load model baru harus aman/atomic).

---

## 11. Frontend

### 11.1 Struktur Menu

Tambahkan halaman baru bernama **AI** sebagai submenu di bawah menu **Attendance** yang sudah ada:

```text
Attendance
├── Dashboard
├── Records
├── Schedule
├── ...
└── AI          ← BARU
```

Route: `/attendance/ai`

**Wajib mengikuti design system / komponen UI yang sudah dipakai di aplikasi existing** (warna, tipografi, komponen tabel/card/filter yang sama dengan halaman Attendance lainnya). Jangan membuat gaya visual baru yang terpisah/berbeda dari aplikasi.

### 11.2 Konten Halaman `/attendance/ai`

Ringkasan/summary (kartu statistik di bagian atas):
- Jumlah karyawan dengan status normal
- Jumlah total anomali
- Jumlah `MISSING_IN`
- Jumlah `MISSING_OUT`
- Jumlah wrong punch (`WRONG_IN` + `WRONG_OUT`)
- Jumlah duplicate (`DUPLICATE_IN` + `DUPLICATE_OUT`)
- Jumlah `LATE`
- Jumlah `OVERTIME`
- Jumlah `ABSENT`
- Jumlah `SHIFT_TRANSITION`

Daftar/tabel karyawan bermasalah, menampilkan per baris:
- Nama karyawan, department, shift
- Tanggal
- Status anomali
- Confidence AI (dalam %)
- Reason/alasan AI (ringkas, bisa expand untuk detail lengkap)
- Perbandingan **raw fingerprint vs hasil interpretasi AI** (tampilkan side-by-side, mis. `07:03 OUT (raw) → 07:03 IN (interpreted)`)
- Aksi: tombol untuk admin melakukan koreksi/konfirmasi status (yang akan tersimpan ke `attendance_ai_feedback`)

### 11.3 Filter

Sediakan filter berikut di halaman ini:
- Tanggal (range tanggal)
- Department
- Employee (karyawan spesifik)
- Shift
- Jenis anomaly (multi-select dari daftar status di bagian 5)
- Confidence (rentang/threshold, mis. tampilkan hanya yang confidence < 80% untuk kasus yang perlu ditinjau manusia)

---

## 12. Prinsip Implementasi

- **Jangan overengineering.** Fokus pada: LightGBM + histori absensi + shift context + real-time inference + halaman Attendance → AI. Tidak perlu menambahkan fitur di luar cakupan ini (mis. tidak perlu dashboard analytics tambahan yang tidak diminta, tidak perlu multi-model ensemble kompleks).
- **Integrasi, bukan penggantian.** Semua tabel, service, dan flow attendance existing tetap dipertahankan. Modul AI ini bersifat additive (menambah tabel baru, menambah service baru, menambah hook/listener kecil di titik yang tepat, menambah halaman frontend baru).
- **Explainability wajib.** Tidak boleh ada prediksi tanpa `reason` yang bisa dibaca manusia dan `confidence` yang jelas.
- **Human-in-the-loop.** Admin harus selalu bisa mengoreksi hasil AI, dan koreksi tersebut harus benar-benar dipakai untuk retraining, bukan sekadar disimpan tanpa digunakan.
- **Efisiensi.** Gunakan rule engine dulu untuk kasus pasti; panggil model AI hanya untuk kasus yang benar-benar ambigu, agar sistem ringan dan tidak butuh GPU.

---

## 13. Definisi Selesai (Acceptance Criteria)

Fitur dianggap selesai apabila:

1. ✅ Struktur project, attendance engine, dan schema PostgreSQL existing sudah diinspeksi dan didokumentasikan (termasuk asumsi bila ada yang tidak ditemukan).
2. ✅ Tabel baru (`attendance_ai_analysis`, `attendance_ai_feedback`, dan opsional `attendance_ai_model_registry`) sudah dibuat via migration, mengikuti konvensi database existing.
3. ✅ Rule engine berhasil mengklasifikasikan kasus-kasus pasti (missing IN/OUT, late, overtime, off, leave/sick/permit) tanpa perlu AI.
4. ✅ Model LightGBM terlatih dari histori absensi existing dan mampu menginterpretasikan kasus ambigu (contoh kasus 1 & 2 di bagian 2 berhasil ditangani dengan benar).
5. ✅ Isolation Forest berjalan sebagai lapisan deteksi anomali/outlier tambahan.
6. ✅ Setiap hasil analisis memiliki `status`, `confidence`, `interpreted_events`, dan `reason` yang human-readable.
7. ✅ AI Engine terpicu otomatis secara asynchronous saat ada transaksi fingerprint baru, dan mampu re-analisis ketika ada transaksi susulan.
8. ✅ Model tersimpan lokal, dan ada mekanisme retraining (terjadwal + manual) yang memanfaatkan feedback koreksi admin.
9. ✅ Halaman `/attendance/ai` tersedia sebagai submenu Attendance, menampilkan seluruh ringkasan, daftar karyawan bermasalah, dan filter sesuai bagian 11, menggunakan design system existing.
10. ✅ Tidak ada penggunaan API AI eksternal, API key eksternal, maupun kebutuhan GPU di seluruh implementasi.

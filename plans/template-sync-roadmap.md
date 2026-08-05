# Roadmap Implementasi Template Sync

Dokumen ini menerjemahkan [`plans/template-sync-plan.md`](plans/template-sync-plan.md) menjadi urutan kerja yang aman dan terukur.

## Status Saat Ini

Project belum siap untuk sinkronisasi template biometrik end-to-end.

Yang sudah tersedia:

- Koneksi ZKTeco TCP 4370 melalui [`app/utils/zklib-employee.js`](../app/utils/zklib-employee.js).
- Percobaan pembacaan jumlah fingerprint melalui [`fetchFingerprintCounts()`](../app/utils/zklib-employee.js:71).
- Skrip investigasi awal [`app/check-fp.mjs`](../app/check-fp.mjs).
- Primitive penulisan user melalui [`writeUserToDevice()`](../app/utils/zklib-employee.js:206).
- Pola disable/enable device pada [`syncServerToDevice()`](../app/utils/zklib-employee.js:265).

Yang belum tersedia:

- Probe dan capability matrix yang tervalidasi.
- Pembacaan/penulisan template fingerprint dan face.
- Penyimpanan template biner dan metadata.
- Device lock bersama semua operasi ZK.
- Sync engine server sebagai source of truth.
- API, scheduler, UI, dan test khusus template sync.

## Prinsip Wajib

1. **Tahap 0 adalah gate.** Jangan mengaktifkan write template sebelum command, payload, ACK, dan format terbukti.
2. **Default deny.** `UNKNOWN`, `PROBE_REQUIRED`, dan `ERROR` harus memblokir operasi write.
3. **Server adalah source of truth.** Device hanya menjadi sumber saat pull dari master.
4. **Kompatibilitas harus dibuktikan.** Jangan menganggap template X105 kompatibel dengan X606-S.
5. **DELETE harus opt-in.** Dry-run dan push default tidak boleh menghapus template.
6. **Tidak ada raw biometric di log.** Log hanya menyimpan checksum, ukuran, metadata terbatas, dan referensi evidence.
7. **Semua operasi ZK memakai lock yang sama.** Attendance, ADMS/PULL, employee sync, dan template sync tidak boleh berjalan bersamaan pada device yang sama.

## Urutan Implementasi

### Fase 0 — Probe Perangkat dan Protokol

**Tujuan:** mendapatkan bukti teknis dari X105 dan X606-S sebelum coding produksi.

#### Pekerjaan

- [ ] Kembangkan [`app/check-fp.mjs`](../app/check-fp.mjs) menjadi probe terstruktur.
- [ ] Simpan model, firmware, serial number, waktu probe, host ter-redact, dan port.
- [ ] Uji fingerprint read melalui `readWithBuffer(table=2)`.
- [ ] Uji fingerprint write dengan fixture non-produksi.
- [ ] Uji kandidat command face read pada X606-S.
- [ ] Uji kandidat command face write pada X606-S.
- [ ] Catat ACK, NAK, timeout, disconnect, replyId, `freeData()`, refresh, dan disable/enable.
- [ ] Ukur payload kecil, ambang batas, payload melebihi batas, dan kebutuhan chunking.
- [ ] Jalankan compatibility test X105 ↔ X606-S untuk fingerprint dan face.
- [ ] Hasilkan artefak JSON dan Markdown.

#### Output

- `probe-results/<model>-<firmware>-<timestamp>.json`
- `probe-results/<model>-<firmware>-<timestamp>.md`
- Capability matrix.
- Cross-device compatibility matrix.

#### Gate

- [ ] Setiap kombinasi wajib berstatus `SUPPORTED` atau `UNSUPPORTED`.
- [ ] Tidak ada kombinasi write yang masih `PROBE_REQUIRED` atau `ERROR`.
- [ ] Kombinasi yang tidak kompatibel terdokumentasi eksplisit.

### Fase 1 — Database dan Device Lock

**Tujuan:** menyediakan penyimpanan template, histori audit, dan eksklusivitas operasi device.

#### Pekerjaan

- [ ] Tambahkan `devices.is_template_master` di [`app/utils/database.js`](../app/utils/database.js:31).
- [ ] Buat tabel `employee_templates` dengan `BYTEA`, checksum, version, payload format, source device, firmware, dan metadata.
- [ ] Buat tabel `template_sync_logs` immutable tanpa `template_data`.
- [ ] Tambahkan index user, source device, device/time, dan checksum.
- [ ] Tambahkan constraint/transaksi agar hanya ada satu master aktif.
- [ ] Implementasikan PostgreSQL advisory lock atau tabel lock TTL.
- [ ] Buat abstraction `TemplateStorage` agar storage dapat dipindah ke object storage di masa depan.
- [ ] Pastikan migrasi/backfill idempotent.

#### Gate

- [ ] `ensureSchema()` aman dijalankan berulang kali.
- [ ] Template dapat disimpan dan diambil lengkap dengan metadata.
- [ ] Raw biometric tidak muncul di tabel log.
- [ ] Dua proses tidak dapat memegang lock device yang sama.

### Fase 2 — Protocol, Capability, dan Template Adapter

**Tujuan:** memisahkan protokol ZK dari keputusan bisnis dan parsing template.

#### Modul

- [ ] [`app/utils/zk-protocol.js`](../app/utils/zk-protocol.js) — TCP, command, header, ACK, buffer, chunking, lifecycle.
- [ ] [`app/utils/device-capability.js`](../app/utils/device-capability.js) — pemilihan capability berdasarkan model+firmware+SN.
- [ ] [`app/utils/zklib-templates.js`](../app/utils/zklib-templates.js) — parser, encoder, checksum, evidence.

#### API internal

- [ ] `readFingerprintTemplates(...)`.
- [ ] `readFaceTemplates(...)`.
- [ ] `writeFingerprintTemplate(...)`.
- [ ] `writeFaceTemplate(...)`.
- [ ] `deleteTemplate(...)`.
- [ ] Refactor [`fetchFingerprintCounts()`](../app/utils/zklib-employee.js:71) agar memakai adapter baru.
- [ ] Semua operasi mengembalikan evidence terstruktur tanpa raw biometric di log.

#### Gate

- [ ] Parser/encoder lolos fixture hasil probe.
- [ ] Capability `SUPPORTED` wajib diverifikasi sebelum write.
- [ ] Format template memiliki `templateVersion` dan `payloadFormat` eksplisit.

### Fase 3 — Template Sync Engine

**File utama:** [`app/utils/template-sync.js`](../app/utils/template-sync.js)

#### Fungsi

- [ ] `pullMasterTemplates()`.
- [ ] `dryRunDeviceSync(deviceId)`.
- [ ] `reconcileTemplatesToDevice(deviceId, options)`.
- [ ] `syncAllTargets()`.

#### Policy

- [ ] ADD dan UPDATE tersedia secara default.
- [ ] DELETE hanya jika `allowDelete=true` dan ada konfirmasi/policy yang sesuai.
- [ ] Target incompatible menghasilkan `SKIP_INCOMPATIBLE`.
- [ ] Template unchanged menghasilkan `SKIP_UNCHANGED`.
- [ ] Capability belum terbukti menghasilkan `ERROR` atau `SKIP_INCOMPATIBLE` tanpa write.
- [ ] Kegagalan satu device tidak menghentikan device lain.
- [ ] Lock diambil sebelum koneksi/operasi dan dilepas melalui `finally`.
- [ ] Device dinonaktifkan selama batch, kemudian refresh dan diaktifkan kembali.
- [ ] Setiap pull, dry-run, write, delete, reconcile, dan error dicatat.

#### Gate

- [ ] Dry-run tidak memiliki side effect.
- [ ] Push ulang bersifat idempotent.
- [ ] DELETE tidak pernah terjadi tanpa opt-in.
- [ ] Lock dilepas saat timeout, disconnect, dan exception.

### Fase 4 — API Admin

**Controller:** [`app/controllers/template-sync.js`](../app/controllers/template-sync.js)

**Route:** [`app/routes/template-sync.js`](../app/routes/template-sync.js)

- [ ] `POST /api/template-sync/pull-master`.
- [ ] `POST /api/template-sync/dry-run/:deviceId`.
- [ ] `POST /api/template-sync/push/:deviceId`.
- [ ] `POST /api/template-sync/push-all`.
- [ ] `GET /api/template-sync/status`.
- [ ] Semua endpoint memakai `syncLimiter`.
- [ ] Semua endpoint memerlukan hak admin.
- [ ] Register route melalui [`app/routes/index.js`](../app/routes/index.js) dan [`app/server.js`](../app/server.js:40).

### Fase 5 — Scheduler Opsional

**File:** [`app/utils/scheduler.js`](../app/utils/scheduler.js)

- [ ] Tambahkan `template_sync_enabled`, default `false`.
- [ ] Tambahkan interval yang tervalidasi.
- [ ] Scheduler hanya menjalankan dry-run atau reconciliation sesuai setting.
- [ ] Scheduler menghormati device lock.
- [ ] Scheduler membuat activity log dan template sync log.

### Fase 6 — Frontend

- [ ] Tambahkan set/unset master dan badge di [`app/public/js/pages/devices.js`](../app/public/js/pages/devices.js).
- [ ] Tambahkan Pull Master, Dry Run, Push, Push All di [`app/public/js/pages/pull-employee.js`](../app/public/js/pages/pull-employee.js).
- [ ] Tampilkan jumlah fingerprint/face dan alasan skip/error.
- [ ] Tambahkan toggle dan interval di [`app/public/js/pages/settings.js`](../app/public/js/pages/settings.js).
- [ ] DELETE harus memiliki konfirmasi eksplisit.

### Fase 7 — Testing

- [ ] Unit test parser/encoder fingerprint.
- [ ] Unit test parser/encoder face.
- [ ] Unit test checksum, metadata, dan diff.
- [ ] Unit test capability selection.
- [ ] Stub socket untuk read/write, ACK, NAK, timeout, dan chunking.
- [ ] Test `PROBE_REQUIRED`, incompatible format, dan unsupported raw ZK.
- [ ] Test lock contention dan release pada exception.
- [ ] Test dry-run tanpa side effect.
- [ ] Test ADD/UPDATE default.
- [ ] Test DELETE hanya dengan opt-in.
- [ ] Test partial failure dan retry.
- [ ] Test idempotency.
- [ ] Test tidak ada raw biometric di `template_sync_logs`.

### Fase 8 — Dokumentasi dan Go-Live

- [ ] Perbarui [`README.md`](../README.md).
- [ ] Perbarui [`Documentation.md`](../Documentation.md).
- [ ] Perbarui [`API_DOCUMENTATION.md`](../API_DOCUMENTATION.md).
- [ ] Dokumentasikan prosedur probe ulang setelah firmware/model/SN berubah.
- [ ] Dokumentasikan rollback dan penghapusan fixture probe.
- [ ] Pastikan auto-sync tetap nonaktif sampai validasi produksi selesai.
- [ ] Lakukan go-live bertahap: satu device, lalu target terbatas, lalu semua target.

## Rekomendasi Commit

Gunakan commit kecil dan terpisah:

1. `probe: add X105 and X606-S capability probe`
2. `db: add template storage and device locks`
3. `zk: add protocol and template adapters`
4. `test: add template protocol fixtures`
5. `sync: add server-authoritative template engine`
6. `api: add template sync admin endpoints`
7. `ui: add template master and sync controls`
8. `docs: document template sync operations`

## Keputusan yang Harus Dihentikan

Implementasi harus berhenti dan tidak melanjutkan ke fase berikutnya jika:

- Face raw ZK tidak terbukti dapat dibaca/ditulis.
- Format source-target tidak kompatibel.
- ACK write tidak dapat diverifikasi.
- Payload besar membutuhkan chunking tetapi protokol finalisasi belum diketahui.
- Device lock tidak dapat diterapkan pada semua operasi ZK.
- Template log masih berpotensi menyimpan raw biometric.

Dalam kondisi tersebut, dokumentasikan status `UNSUPPORTED_RAW_ZK` atau `PROBE_REQUIRED` dan gunakan fallback yang disetujui secara eksplisit; jangan melakukan silent downgrade.

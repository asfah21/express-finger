export const SYNC_CONFIG = {
    // Interval dalam milidetik. 5 menit = 300000, 1 jam = 3600000
    // 1 menit agar data mesin fingerprint tampil cepat (mendekati realtime),
    // sekaligus jadi jaring pengaman bila push /iclock dari mesin lambat.
    PULL_INTERVAL: 300000, // 5 menit

    // Berapa hari simpan file audit di /data/pull?
    KEEP_AUDIT_FILES_DAYS: 3,

    // Berapa hari simpan file raw push di /data/raw?
    KEEP_RAW_FILES_DAYS: 3,

    // Filter tanggal masa depan (proteksi data korup)
    MAX_FUTURE_DAYS: 1,

    // Mode debug untuk melihat raw hex data jika perlu
    DEBUG_MODE: false
};

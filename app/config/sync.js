export const SYNC_CONFIG = {
    // Interval dalam milidetik. 5 menit = 300000, 1 jam = 3600000
    PULL_INTERVAL: 600000, // 10 menit

    // Berapa hari simpan file audit di /data/pull?
    KEEP_AUDIT_FILES_DAYS: 3,

    // Berapa hari simpan file raw push di /data/raw?
    KEEP_RAW_FILES_DAYS: 3,

    // Filter tanggal masa depan (proteksi data korup)
    MAX_FUTURE_DAYS: 1,

    // Mode debug untuk melihat raw hex data jika perlu
    DEBUG_MODE: false
};

/**
 * Priority Devices Configuration
 * 
 * If a device Serial Number (SN) is defined here, the PULL worker 
 * will ALWAYS use this IP and Port instead of the one detected via PUSH/ADMS.
 * 
 * Format:
 * 'SERIAL_NUMBER': { ip: 'IP_ADDRESS', port: PORT }
 */

export const priorityDevices = {
    // Contoh mesin fokus dengan ZeroTier
    'CKEB233960333': { ip: '10.242.15.136', port: 4370 },

    // Tambahkan SN lainnya di sini jika menggunakan IP Statis/VPN/ZeroTier
    // 'SN_LAIN': { ip: '10.242.x.x', port: 4370 }
}

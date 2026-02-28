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

    // Daftarkan mesin yang sebelumnya di-skip karena Public IP
    'ZTC8243601284': { ip: '114.10.132.88', port: 4370 },
    'ZTC8252600078': { ip: '114.10.132.88', port: 4370 },
    'ZTC8253400119': { ip: '114.10.132.88', port: 4370 },
}
